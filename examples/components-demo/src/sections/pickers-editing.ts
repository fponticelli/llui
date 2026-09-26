import {
  div,
  button,
  span,
  label,
  input,
  select,
  option,
  canvas,
  each,
  onMount,
  branch,
  text,
} from '@llui/dom'
import type { Send, Signal, Renderable } from '@llui/dom'
import { datePicker, monthGrid, weekRows } from '@llui/components/date-picker'
import { timePicker, formatTime } from '@llui/components/time-picker'
import { colorPicker } from '@llui/components/color-picker'
import { gradientPicker } from '@llui/components/gradient-picker'
import { angleSlider, type AngleSliderMsg } from '@llui/components/angle-slider'
import { editable } from '@llui/components/editable'
import { clipboard, copyToClipboard } from '@llui/components/clipboard'
import { fileUpload } from '@llui/components/file-upload'
import { splitter } from '@llui/components/splitter'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

const children = {
  datePicker,
  timePicker,
  colorPicker,
  gradientPicker,
  editable,
  clipboard,
  fileUpload,
  splitter,
} as const

export type State = ModulesState<typeof children>
export type Msg =
  | ModulesMsg<typeof children>
  /**
   * @intent("Copy the given text to the clipboard")
   * @example("{\"type\":\"copyText\",\"value\":\"https://llui.dev\"}")
   */
  | { type: 'copyText'; value: string }

// The clipboard write and the delayed "Copied!" reset are side effects, so they
// leave the reducer as an Effect and run in `onEffect` (the impure boundary) —
// no module-global `send`, no `setTimeout` inside `update`.
export type Effect = { type: 'copyToClipboard'; value: string }

export const init = (): [State, Effect[]] => [
  {
    datePicker: datePicker.init({ value: '2026-04-15' }),
    timePicker: timePicker.init({ value: { hours: 14, minutes: 30, seconds: 0 }, format: '12' }),
    colorPicker: colorPicker.init({ hsl: { h: 210, s: 70, l: 50 } }),
    gradientPicker: gradientPicker.init({
      angle: 90,
      stops: [
        { position: 0, color: 'oklch(0.65 0.2 25)' },
        { position: 100, color: 'oklch(0.65 0.2 265)' },
      ],
      interpolation: { space: 'oklch', hue: 'shorter' },
    }),
    editable: editable.init({ value: 'Click me to edit' }),
    clipboard: clipboard.init({ value: 'pnpm install @llui/components' }),
    fileUpload: fileUpload.init({ multiple: true, maxFiles: 3 }),
    splitter: splitter.init({ position: 50, orientation: 'horizontal' }),
  },
  [],
]

export const update = mergeHandlers<State, Msg, Effect>(
  composeModules<State, Msg, Effect>(children),
  (state, msg) => {
    if (msg.type !== 'copyText') return null
    // NOT an optimistic flip: the write can be refused (permission, insecure
    // context) and the clipboard's `indicator` is an aria-live region, so only
    // a RESOLVED write may claim success (#232). The reducer just asks.
    return [state, [{ type: 'copyToClipboard', value: msg.value }]]
  },
)

/**
 * Route this section's effects. `copyToClipboard` performs the async clipboard
 * write; only its RESOLVED branch dispatches `copied` and schedules the reset.
 * A refused write dispatches nothing, so the button keeps saying "Copy" and the
 * live region stays silent rather than announcing a copy that never happened.
 * `setTimeout` here is legitimate — an effect handler is the impure boundary;
 * the reducer stays pure.
 */
export function onEffect(effect: Effect, send: Send<Msg>): void {
  if (effect.type !== 'copyToClipboard') return
  void copyToClipboard(effect.value).then(
    () => {
      send({ type: 'clipboard', msg: { type: 'copied' } })
      setTimeout(() => send({ type: 'clipboard', msg: { type: 'reset' } }), 2000)
    },
    () => {},
  )
}

function todayIsoString(): string {
  const d = new Date()
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const dp = datePicker.connect(state.at('datePicker'), (m) => send({ type: 'datePicker', msg: m }))
  const tp = timePicker.connect(state.at('timePicker'), (m) => send({ type: 'timePicker', msg: m }))
  const cp = colorPicker.connect(state.at('colorPicker'), (m) =>
    send({ type: 'colorPicker', msg: m }),
  )
  const ed = editable.connect(state.at('editable'), (m) => send({ type: 'editable', msg: m }))
  const cb = clipboard.connect(state.at('clipboard'), (m) => send({ type: 'clipboard', msg: m }))
  const fu = fileUpload.connect(
    state.at('fileUpload'),
    (m) => send({ type: 'fileUpload', msg: m }),
    {
      id: 'upload-demo',
    },
  )
  const sp = splitter.connect(state.at('splitter'), (m) => send({ type: 'splitter', msg: m }))
  const gp = gradientPicker.connect(
    state.at('gradientPicker'),
    (m) => send({ type: 'gradientPicker', msg: m }),
    { id: 'gp-demo' },
  )

  // `angle-slider` composed over gradient-picker's OWN `angle` field — no
  // separate stored state for it. A fresh `AngleSliderState` is derived from
  // the live angle on every render; any message it produces (`setValue`,
  // `increment`, …) is replayed through `angleSlider.update` and the
  // resulting value is forwarded as gradient-picker's `setAngle`. This is
  // the "trivially composable with angle-slider" case from the machine's
  // own doc comment: gradient-picker publishes a plain `angleInput` range
  // part, but any OTHER angle-editing UI (a circular drag control, here)
  // works against the exact same field with zero glue beyond this translator.
  const angleSliderSend = (m: AngleSliderMsg): void => {
    const derived = angleSlider.init({ value: state.peek().gradientPicker.angle })
    const [next] = angleSlider.update(derived, m)
    send({ type: 'gradientPicker', msg: { type: 'setAngle', angle: next.value } })
  }
  const as = angleSlider.connect(
    state.at('gradientPicker').map((s) => angleSlider.init({ value: s.angle })),
    angleSliderSend,
  )
  // Same pointer-drag glue `time-inputs.ts`'s own Angle Slider card uses:
  // the machine computes no pointer handling of its own (it leaves that to
  // the consumer), so both cards install it identically.
  const onAngleControlDown = (e: PointerEvent): void => {
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const setFromPointer = (ev: PointerEvent): void => {
      const rect = el.getBoundingClientRect()
      const angle = angleSlider.angleFromPoint(rect, ev.clientX, ev.clientY)
      angleSliderSend({ type: 'setValue', value: angle })
    }
    setFromPointer(e)
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId === e.pointerId) setFromPointer(ev)
    }
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  // Two READ-ONLY previews of the SAME stops/kind, differing only in
  // `interpolation.space` — `srgb` (naive channel-average) vs `oklch`
  // (perceptually-uniform) visibly diverge for saturated stops.
  const interpolationCompare = state.at('gradientPicker').map((s) => ({
    srgb: gradientPicker.toCss({
      ...s,
      interpolation: { space: 'srgb' as const, hue: 'shorter' as const },
    }),
    oklch: gradientPicker.toCss({
      ...s,
      interpolation: { space: 'oklch' as const, hue: 'shorter' as const },
    }),
  }))

  // Editable focus on edit
  const previewParts = { ...ed.preview }
  const origClick = previewParts.onClick
  previewParts.onClick = (e: MouseEvent): void => {
    origClick(e)
    queueMicrotask(() => {
      const inp = document.querySelector<HTMLInputElement>(
        '[data-scope="editable"][data-part="input"]',
      )
      inp?.focus()
      inp?.select()
    })
  }

  // Splitter drag
  const splitterMount = onMount(() => {
    const root = document.querySelector<HTMLElement>('[data-scope="splitter"][data-part="root"]')
    const handle = document.querySelector<HTMLElement>(
      '[data-scope="splitter"][data-part="resize-trigger"]',
    )
    if (!root || !handle) return
    let dragging = false
    const pct = (x: number): number => {
      const r = root.getBoundingClientRect()
      return Math.round(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)))
    }
    const onDown = (e: PointerEvent): void => {
      dragging = true
      handle.setPointerCapture(e.pointerId)
      send({ type: 'splitter', msg: { type: 'startDrag' } })
      send({ type: 'splitter', msg: { type: 'setPosition', position: pct(e.clientX) } })
    }
    const onMove = (e: PointerEvent): void => {
      if (dragging)
        send({ type: 'splitter', msg: { type: 'setPosition', position: pct(e.clientX) } })
    }
    const onUp = (e: PointerEvent): void => {
      if (!dragging) return
      dragging = false
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      send({ type: 'splitter', msg: { type: 'endDrag' } })
    }
    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
    return () => {
      handle.removeEventListener('pointerdown', onDown)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
  })

  // OKLCH area canvas: `areaCanvas` is a decorative, headless seam, but the
  // machine now owns its own repaint-on-change wiring — `areaCanvasBinding`
  // rides the same chunked-mask reconciler as every other prop (repaints only
  // when the hue/maxChroma chunk is actually dirty) and finds the real canvas
  // itself, so this view no longer touches `registerBinding`/`isSignalHandle`/
  // `currentDoc` at all.
  const oklchCanvasId = 'color-picker-oklch-canvas'
  const oklchCanvasBinding = colorPicker.areaCanvasBinding(state.at('colorPicker'), oklchCanvasId)

  // Eyedropper support: the machine owns feature-detection too — this mount
  // helper dispatches `setEyeDropperSupported` once, and `cp.eyeDropperTrigger`
  // already publishes `hidden`/`disabled`/`data-unsupported` from that state.
  // This view writes zero feature-detect code of its own.
  const eyeDropperMount = colorPicker.eyeDropperSupportMount((m) =>
    send({ type: 'colorPicker', msg: m }),
  )

  const dpGrid = (): Renderable => {
    const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    // The baked theme applies `display: grid; grid-template-columns: repeat(7, 1fr)`
    // to dp.grid via attribute selector. Flatten rows with `display: contents`
    // so cells become direct grid children and wrap every 7 (one week per row).
    const rowClass = 'contents'
    const dowRow = div(
      { ...dp.row, class: rowClass },
      dowLabels.map((d) =>
        span(
          {
            role: 'columnheader',
            class: 'text-center text-[0.625rem] uppercase text-muted-foreground py-1',
          },
          [text(d)],
        ),
      ),
    )
    const rows = each(
      state.at('datePicker').map((dpState) => weekRows(monthGrid(dpState))),
      {
        // `weekRows` returns `DayCell[][]`, so the first cell is not typed as
        // present. A week from `monthGrid` always has seven, but the key has to
        // be total: an empty row keys as '' rather than throwing mid-reconcile.
        key: (row) => row[0]?.iso ?? '',
        render: (item) => {
          const week = item.peek()
          return [
            div(
              { ...dp.row, class: rowClass },
              week.map((cell) =>
                button(
                  {
                    role: 'gridcell',
                    class:
                      'inline-flex items-center justify-center w-9 h-9 rounded-md text-sm cursor-pointer bg-transparent border-none text-foreground hover:bg-accent transition-colors duration-fast data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[today]:font-bold data-[in-month=false]:opacity-40',
                    'data-date': cell.iso,
                    'data-in-month': cell.inMonth ? 'true' : 'false',
                    'data-today': cell.iso === todayIsoString() ? '' : undefined,
                    'data-selected': state
                      .at('datePicker')
                      .map((s) => (s.value === cell.iso ? '' : undefined)),
                    'data-focused': state
                      .at('datePicker')
                      .map((s) => (s.focused === cell.iso ? '' : undefined)),
                    tabindex: state.at('datePicker').map((s) => (s.focused === cell.iso ? 0 : -1)),
                    onClick: () => {
                      send({ type: 'datePicker', msg: { type: 'setFocused', date: cell.iso } })
                      send({ type: 'datePicker', msg: { type: 'selectFocused' } })
                    },
                  },
                  [text(String(cell.day))],
                ),
              ),
            ),
          ]
        },
      },
    )
    return [dowRow, rows]
  }

  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]

  return [
    // Placed so the splitter drag onMount registers (a discarded onMount() is inert).
    splitterMount,
    // Same reason: a placed-but-unused Mountable is inert.
    ...oklchCanvasBinding,
    eyeDropperMount,
    sectionGroup('Pickers', [
      card('Date Picker', [
        div({ ...dp.root }, [
          div({ class: 'flex items-center justify-between mb-2' }, [
            button({ ...dp.prevMonthTrigger }, [text('‹')]),
            span({ class: 'text-sm font-semibold' }, [
              text(
                state.at('datePicker').map((s) => `${months[s.visibleMonth - 1]} ${s.visibleYear}`),
              ),
            ]),
            button({ ...dp.nextMonthTrigger }, [text('›')]),
          ]),
          // dp.grid is a factory (offset → parts); it must be CALLED. Spreading
          // the bare function copies no own-enumerable props, so the grid div
          // would render attribute-less and lose `display: grid` — collapsing
          // the weekday header into a left-packed run instead of 7 columns.
          div({ ...dp.grid() }, dpGrid()),
        ]),
        div({ class: 'mt-3 text-sm text-muted-foreground' }, [
          text('Selected: '),
          text(state.at('datePicker').map((s) => s.value ?? 'none')),
        ]),
      ]),
      card('Time Picker', [
        div({ ...tp.root }, [
          input({ ...tp.hoursInput }),
          span({ class: 'font-semibold text-muted-foreground' }, [text(':')]),
          input({ ...tp.minutesInput }),
          button({ ...tp.periodTrigger }, [
            text(state.at('timePicker').map((s) => (s.value.hours >= 12 ? 'PM' : 'AM'))),
          ]),
        ]),
        div({ class: 'mt-3 text-sm text-muted-foreground' }, [
          text('Time: '),
          text(state.at('timePicker').map((s) => formatTime(s))),
        ]),
      ]),
      card('Color Picker', [
        div({ ...cp.root }, [
          div({ class: 'flex items-center gap-2' }, [
            div({ ...cp.preview }, []),
            input({ ...cp.hexInput, class: 'flex-1' }),
            button({ ...cp.eyeDropperTrigger, class: 'btn btn-secondary btn-sm' }, [text('◎')]),
            button({ ...cp.modelToggle, class: 'btn btn-secondary btn-sm' }, [
              text(state.at('colorPicker').map((s) => (s.color.model === 'hsv' ? 'OKLCH' : 'HSV'))),
            ]),
          ]),
          div({ ...cp.area }, [
            canvas({ ...cp.areaCanvas, id: oklchCanvasId, width: 240, height: 128 }),
            div({ ...cp.areaThumb }, []),
          ]),
          div({ class: 'flex flex-col gap-1.5' }, [
            branch(
              state.at('colorPicker').map((s) => s.color.model),
              {
                hsv: () => [
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('H')]), input({ ...cp.hueSlider })],
                  ),
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('S')]), input({ ...cp.saturationSlider })],
                  ),
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('L')]), input({ ...cp.lightnessSlider })],
                  ),
                ],
                oklch: () => [
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('H')]), input({ ...cp.hueSlider })],
                  ),
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('C')]), input({ ...cp.chromaSlider })],
                  ),
                  label(
                    {
                      class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold',
                    },
                    [span([text('L')]), input({ ...cp.oklchLightnessSlider })],
                  ),
                ],
              },
            ),
            label(
              { class: 'flex items-center gap-2 text-xs text-muted-foreground font-semibold' },
              [span([text('A')]), input({ ...cp.alphaSlider })],
            ),
          ]),
        ]),
        div({ class: 'mt-3 text-sm text-muted-foreground' }, [
          text('CSS: '),
          text(state.at('colorPicker').map((s) => colorPicker.toCss(s))),
        ]),
      ]),
      card('Gradient Picker', [
        div({ ...gp.root }, [
          div({ ...gp.preview }, []),
          div({ ...gp.track }, [
            each(state.at('gradientPicker.stops'), {
              key: (stop) => stop.id,
              render: (item) => {
                // A keyed row's id never changes across its own lifetime (a
                // changed id tears down this row and builds a fresh one), so
                // reading it once here — rather than inside the returned
                // slot — is the deliberate one-shot case `peek-in-slot` asks
                // for: snapshot in a block-body `const`, pass the plain
                // value into `gp.stop`, which itself returns live Signals.
                const stopId = item.peek().id
                return [div({ ...gp.stop(stopId) }, [])]
              },
            }),
          ]),
          div({ class: 'flex items-center gap-2' }, [
            // Icon-only (the machine already publishes an `aria-label`);
            // `add-stop-button`/`remove-stop-button` are styled as small
            // fixed-size square buttons — see form-controls.css.
            button({ ...gp.addStopButton }, [text('+')]),
            button({ ...gp.removeStopButton }, [text('−')]),
            button({ ...gp.reverseButton }, [text('Reverse')]),
            button({ ...gp.distributeButton }, [text('Distribute')]),
          ]),
          div({ class: 'flex items-center gap-2' }, [
            button({ ...gp.kindToggle('linear') }, [text('Linear')]),
            button({ ...gp.kindToggle('radial') }, [text('Radial')]),
            button({ ...gp.kindToggle('conic') }, [text('Conic')]),
            button({ ...gp.repeatingToggle }, [text('Repeating')]),
          ]),
          branch(
            state.at('gradientPicker').map((s) => s.kind),
            {
              linear: () => [
                label({ class: 'flex items-center gap-2 text-xs text-muted-foreground' }, [
                  span([text('Angle')]),
                  input({ ...gp.angleInput }),
                ]),
              ],
              conic: () => [
                label({ class: 'flex items-center gap-2 text-xs text-muted-foreground' }, [
                  span([text('Angle')]),
                  input({ ...gp.angleInput }),
                ]),
                div({ ...gp.centerArea }, [div({ ...gp.centerThumb }, [])]),
              ],
              radial: () => [
                div({ class: 'flex items-center gap-2' }, [
                  button({ ...gp.shapeOption('circle') }, [text('Circle')]),
                  button({ ...gp.shapeOption('ellipse') }, [text('Ellipse')]),
                ]),
                div({ class: 'flex items-center gap-2' }, [
                  button({ ...gp.sizeOption('closest-side') }, [text('Closest side')]),
                  button({ ...gp.sizeOption('farthest-corner') }, [text('Farthest corner')]),
                ]),
                div({ ...gp.centerArea }, [div({ ...gp.centerThumb }, [])]),
              ],
            },
          ),
          div({ class: 'flex items-center gap-2' }, [
            select({ ...gp.interpolationSpaceSelect }, [
              option({ value: 'srgb' }, [text('sRGB')]),
              option({ value: 'srgb-linear' }, [text('sRGB (linear)')]),
              option({ value: 'hsl' }, [text('HSL')]),
              option({ value: 'oklab' }, [text('OKLab')]),
              option({ value: 'oklch' }, [text('OKLCH')]),
            ]),
            select({ ...gp.interpolationHueSelect }, [
              option({ value: 'shorter' }, [text('shorter hue')]),
              option({ value: 'longer' }, [text('longer hue')]),
              option({ value: 'increasing' }, [text('increasing hue')]),
              option({ value: 'decreasing' }, [text('decreasing hue')]),
            ]),
          ]),
          div(
            {
              ...as.root,
              'aria-label': 'Angle (angle-slider composition)',
              class:
                'flex items-center gap-3 text-xs text-muted-foreground rounded focus:outline focus:outline-2 focus:outline-blue-300',
            },
            [
              span([text('Angle (angle-slider composition)')]),
              div(
                {
                  ...as.control,
                  class:
                    'relative h-10 w-10 shrink-0 rounded-full border-2 border-border cursor-pointer touch-none',
                  onPointerDown: onAngleControlDown,
                },
                [
                  div(
                    {
                      ...as.thumb,
                      class: 'absolute h-2 w-2 rounded-full bg-primary',
                      style: state.at('gradientPicker').map((s) => {
                        const { x, y } = angleSlider.pointFromAngle(s.angle)
                        const r = 16
                        return (
                          `left:50%;top:50%;` +
                          `transform:translate(calc(-50% + ${(x * r).toFixed(2)}px),calc(-50% + ${(y * r).toFixed(2)}px));`
                        )
                      }),
                    },
                    [],
                  ),
                ],
              ),
              span({ class: 'font-mono' }, [
                text(state.at('gradientPicker').map((s) => `${Math.round(s.angle)}°`)),
              ]),
            ],
          ),
          input({ ...gp.cssInput, class: 'w-full' }),
          div({ class: 'flex flex-col gap-1.5 border-t pt-2' }, [
            span({ class: 'text-xs font-semibold text-muted-foreground' }, [
              text('Selected stop (embedded color-picker)'),
            ]),
            div({ class: 'flex items-center gap-2' }, [
              div({ ...gp.picker.preview }, []),
              input({ ...gp.picker.hexInput, class: 'flex-1' }),
              button({ ...gp.picker.modelToggle }, [
                text(
                  state
                    .at('gradientPicker')
                    .map((s) =>
                      gradientPicker.pickerStateOf(s).color.model === 'hsv' ? 'OKLCH' : 'HSV',
                    ),
                ),
              ]),
            ]),
          ]),
        ]),
        div({ class: 'mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground' }, [
          div([
            text('in srgb'),
            div(
              {
                class: 'mt-1 h-8 rounded-md border',
                style: interpolationCompare.map((c) => `background:${c.srgb};`),
              },
              [],
            ),
          ]),
          div([
            text('in oklch'),
            div(
              {
                class: 'mt-1 h-8 rounded-md border',
                style: interpolationCompare.map((c) => `background:${c.oklch};`),
              },
              [],
            ),
          ]),
        ]),
      ]),
    ]),
    sectionGroup('Inline editing', [
      card('Editable', [
        div({ ...ed.root }, [
          span({ ...previewParts }, [
            text(state.at('editable').map((e) => e.value || 'Click to edit')),
          ]),
          input({ ...ed.input }),
        ]),
        div({ class: 'mt-2 text-xs text-muted-foreground' }, [
          text('Click, edit, Enter to commit, Esc to cancel'),
        ]),
      ]),
      card('Clipboard', [
        div({ ...cb.root }, [
          input({ ...cb.input, 'aria-label': 'Text to copy' }),
          button(
            {
              ...cb.trigger,
              class: 'btn btn-secondary btn-sm',
              onClick: (e: MouseEvent) => {
                const root = (e.currentTarget as HTMLElement).closest(
                  '[data-scope="clipboard"][data-part="root"]',
                )
                const inp = root?.querySelector<HTMLInputElement>('[data-part="input"]')
                send({ type: 'copyText', value: inp?.value ?? '' })
              },
            },
            [text(state.at('clipboard').map((c) => (c.copied ? 'Copied!' : 'Copy')))],
          ),
        ]),
      ]),
      card('File Upload', [
        div({ ...fu.root }, [
          div({ ...fu.dropzone }, [
            text('Drag files here or click to browse'),
            input({ ...fu.hiddenInput }),
          ]),
          div({ class: 'text-xs text-muted-foreground' }, [
            each(state.at('fileUpload.files'), {
              key: (f) => f.id,
              render: (item) => [
                div({ class: 'py-1' }, [
                  text(item.at('name')),
                  text(' ('),
                  text(item.map((f) => `${Math.round(f.size / 1024)}kb`)),
                  text(')'),
                ]),
              ],
            }),
          ]),
        ]),
      ]),
      card('Splitter', [
        div({ ...sp.root }, [
          div({ ...sp.primaryPanel }, [text('Left pane')]),
          div({ ...sp.resizeTrigger }, []),
          div({ ...sp.secondaryPanel }, [text('Right pane')]),
        ]),
        div({ class: 'mt-2 text-xs text-muted-foreground' }, [
          text('Drag handle or arrow keys — split at '),
          text(state.at('splitter').map((s) => `${s.position}%`)),
        ]),
      ]),
    ]),
  ]
}
