import { div, button, span, label, input, each, onMount, text } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { datePicker, type DayCell, monthGrid, weekRows } from '@llui/components/date-picker'
import { timePicker, formatTime } from '@llui/components/time-picker'
import { colorPicker } from '@llui/components/color-picker'
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
   * @example({"type":"copyText","value":"https://llui.dev"})
   */
  | { type: 'copyText'; value: string }

let localSend: (m: Msg) => void = () => {
  throw new Error('send not initialized')
}

export const init = (): [State, never[]] => [
  {
    datePicker: datePicker.init({ value: '2026-04-15' }),
    timePicker: timePicker.init({ value: { hours: 14, minutes: 30, seconds: 0 }, format: '12' }),
    colorPicker: colorPicker.init({ hsl: { h: 210, s: 70, l: 50 } }),
    editable: editable.init({ value: 'Click me to edit' }),
    clipboard: clipboard.init({ value: 'pnpm install @llui/components' }),
    fileUpload: fileUpload.init({ multiple: true, maxFiles: 3 }),
    splitter: splitter.init({ position: 50, orientation: 'horizontal' }),
  },
  [],
]

export const update = mergeHandlers<State, Msg, never>(
  composeModules<State, Msg, never>(children),
  (state, msg) => {
    if (msg.type !== 'copyText') return null
    void copyToClipboard(msg.value).catch(() => {})
    const [cb] = clipboard.update(state.clipboard, { type: 'copy' })
    setTimeout(() => localSend({ type: 'clipboard', msg: { type: 'reset' } }), 2000)
    return [{ ...state, clipboard: cb }, []]
  },
)

function todayIsoString(): string {
  const d = new Date()
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function view(state: Signal<State>, send: Send<Msg>): Node[] {
  localSend = send
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

  const dpGrid = (): Node[] => {
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
            class: 'text-center text-[0.625rem] uppercase text-text-muted py-1',
          },
          [text(d)],
        ),
      ),
    )
    const rows = each(
      state.at('datePicker').map((dpState) => weekRows(monthGrid(dpState))),
      {
        key: (row) => row[0].iso,
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
                      'inline-flex items-center justify-center w-9 h-9 rounded-md text-sm cursor-pointer bg-transparent border-none text-text hover:bg-surface-hover transition-colors duration-fast data-[selected]:bg-primary data-[selected]:text-text-inverted data-[today]:font-bold data-[in-month=false]:opacity-40',
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
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Selected: '),
          text(state.at('datePicker').map((s) => s.value ?? 'none')),
        ]),
      ]),
      card('Time Picker', [
        div({ ...tp.root }, [
          input({ ...tp.hoursInput }),
          span({ class: 'font-semibold text-text-muted' }, [text(':')]),
          input({ ...tp.minutesInput }),
          button({ ...tp.periodTrigger }, [
            text(state.at('timePicker').map((s) => (s.value.hours >= 12 ? 'PM' : 'AM'))),
          ]),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Time: '),
          text(state.at('timePicker').map((s) => formatTime(s))),
        ]),
      ]),
      card('Color Picker', [
        div({ ...cp.root }, [
          div({ class: 'flex items-center gap-2' }, [
            div({ ...cp.swatch }, []),
            input({ ...cp.hexInput }),
          ]),
          div({ class: 'flex flex-col gap-1.5' }, [
            label({ class: 'flex items-center gap-2 text-xs text-text-muted font-semibold' }, [
              span([text('H')]),
              input({ ...cp.hueSlider }),
            ]),
            label({ class: 'flex items-center gap-2 text-xs text-text-muted font-semibold' }, [
              span([text('S')]),
              input({ ...cp.saturationSlider }),
            ]),
            label({ class: 'flex items-center gap-2 text-xs text-text-muted font-semibold' }, [
              span([text('L')]),
              input({ ...cp.lightnessSlider }),
            ]),
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
        div({ class: 'mt-2 text-xs text-text-muted' }, [
          text('Click, edit, Enter to commit, Esc to cancel'),
        ]),
      ]),
      card('Clipboard', [
        div({ ...cb.root }, [
          input({ ...cb.input, 'aria-label': 'Text to copy' }),
          button(
            {
              ...cb.trigger,
              class: 'btn btn-secondary text-xs',
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
          div({ class: 'text-xs text-text-muted' }, [
            each(state.at('fileUpload.files'), {
              key: (f) => f.name,
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
        div({ class: 'mt-2 text-xs text-text-muted' }, [
          text('Drag handle or arrow keys — split at '),
          text(state.at('splitter').map((s) => `${s.position}%`)),
        ]),
      ]),
    ]),
  ]
}
