import {
  component,
  mountApp,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  label,
  input,
  onMount,
} from '@llui/dom'
import {
  datePicker,
  type DatePickerState,
  type DatePickerMsg,
  type DayCell,
  monthGrid,
} from '@llui/components/date-picker'
import {
  timePicker,
  type TimePickerState,
  type TimePickerMsg,
  formatTime,
} from '@llui/components/time-picker'
import {
  colorPicker,
  type ColorPickerState,
  type ColorPickerMsg,
} from '@llui/components/color-picker'
import { editable, type EditableState, type EditableMsg } from '@llui/components/editable'
import {
  clipboard,
  type ClipboardState,
  type ClipboardMsg,
  copyToClipboard,
} from '@llui/components/clipboard'
import { fileUpload, type FileUploadState, type FileUploadMsg } from '@llui/components/file-upload'
import { splitter, type SplitterState, type SplitterMsg } from '@llui/components/splitter'
import { sectionGroup, card } from '../shared/ui'

type State = {
  datePicker: DatePickerState
  timePicker: TimePickerState
  colorPicker: ColorPickerState
  editable: EditableState
  clipboard: ClipboardState
  fileUpload: FileUploadState
  splitter: SplitterState
}
type Msg =
  | { type: 'datePicker'; msg: DatePickerMsg }
  | { type: 'timePicker'; msg: TimePickerMsg }
  | { type: 'colorPicker'; msg: ColorPickerMsg }
  | { type: 'editable'; msg: EditableMsg }
  | { type: 'clipboard'; msg: ClipboardMsg }
  | { type: 'fileUpload'; msg: FileUploadMsg }
  | { type: 'splitter'; msg: SplitterMsg }
  | { type: 'copyText'; value: string }

let localSend: (m: Msg) => void = () => {
  throw new Error('send not initialized')
}

const init = (): [State, never[]] => [
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

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.datePicker,
    set: (s, v) => ({ ...s, datePicker: v }),
    narrow: (m) => (m.type === 'datePicker' ? m.msg : null),
    sub: datePicker.update,
  }),
  sliceHandler({
    get: (s) => s.timePicker,
    set: (s, v) => ({ ...s, timePicker: v }),
    narrow: (m) => (m.type === 'timePicker' ? m.msg : null),
    sub: timePicker.update,
  }),
  sliceHandler({
    get: (s) => s.colorPicker,
    set: (s, v) => ({ ...s, colorPicker: v }),
    narrow: (m) => (m.type === 'colorPicker' ? m.msg : null),
    sub: colorPicker.update,
  }),
  sliceHandler({
    get: (s) => s.editable,
    set: (s, v) => ({ ...s, editable: v }),
    narrow: (m) => (m.type === 'editable' ? m.msg : null),
    sub: editable.update,
  }),
  sliceHandler({
    get: (s) => s.clipboard,
    set: (s, v) => ({ ...s, clipboard: v }),
    narrow: (m) => (m.type === 'clipboard' ? m.msg : null),
    sub: clipboard.update,
  }),
  sliceHandler({
    get: (s) => s.fileUpload,
    set: (s, v) => ({ ...s, fileUpload: v }),
    narrow: (m) => (m.type === 'fileUpload' ? m.msg : null),
    sub: fileUpload.update,
  }),
  sliceHandler({
    get: (s) => s.splitter,
    set: (s, v) => ({ ...s, splitter: v }),
    narrow: (m) => (m.type === 'splitter' ? m.msg : null),
    sub: splitter.update,
  }),
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

const App = component<State, Msg, never>({
  name: 'PickersEditingSection',
  init,
  update,
  view: (send, { each }) => {
    localSend = send
    const dp = datePicker.connect<State>(
      (s) => s.datePicker,
      (m) => send({ type: 'datePicker', msg: m }),
    )
    const tp = timePicker.connect<State>(
      (s) => s.timePicker,
      (m) => send({ type: 'timePicker', msg: m }),
    )
    const cp = colorPicker.connect<State>(
      (s) => s.colorPicker,
      (m) => send({ type: 'colorPicker', msg: m }),
    )
    const ed = editable.connect<State>(
      (s) => s.editable,
      (m) => send({ type: 'editable', msg: m }),
    )
    const cb = clipboard.connect<State>(
      (s) => s.clipboard,
      (m) => send({ type: 'clipboard', msg: m }),
    )
    const fu = fileUpload.connect<State>(
      (s) => s.fileUpload,
      (m) => send({ type: 'fileUpload', msg: m }),
      { id: 'upload-demo' },
    )
    const sp = splitter.connect<State>(
      (s) => s.splitter,
      (m) => send({ type: 'splitter', msg: m }),
    )

    // Editable focus on edit
    const previewParts = { ...ed.preview }
    const origClick = previewParts.onClick
    previewParts.onClick = (e: MouseEvent): void => {
      origClick(e)
      queueMicrotask(() => {
        const inp = document.querySelector<HTMLInputElement>('.editable-input')
        inp?.focus()
        inp?.select()
      })
    }

    // Splitter drag
    onMount(() => {
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
      const dowCells = dowLabels.map((d) => span({ class: 'dp-dow' }, [text(d)]))
      const cells = each({
        items: (s) => monthGrid(s.datePicker),
        key: (c) => c.iso,
        render: ({ item }) => {
          const iso = item((c: DayCell) => c.iso)()
          const day = item((c: DayCell) => c.day)()
          const inMonth = item((c: DayCell) => c.inMonth)()
          return [
            button(
              {
                role: 'gridcell',
                'data-date': iso,
                'data-in-month': inMonth ? '' : undefined,
                'data-today': (s: State) => (iso === todayIsoString() ? '' : undefined),
                'data-selected': (s: State) => (s.datePicker.value === iso ? '' : undefined),
                'data-focused': (s: State) => (s.datePicker.focused === iso ? '' : undefined),
                tabIndex: (s: State) => (s.datePicker.focused === iso ? 0 : -1),
                class: 'dp-day',
                onClick: () => {
                  send({ type: 'datePicker', msg: { type: 'setFocused', date: iso } })
                  send({ type: 'datePicker', msg: { type: 'selectFocused' } })
                },
              },
              [text(String(day))],
            ),
          ]
        },
      })
      return [...dowCells, ...cells]
    }

    return [
      sectionGroup('Pickers', [
        card('Date Picker', [
          div({ ...dp.root, class: 'datepicker' }, [
            div({ class: 'dp-header' }, [
              button({ ...dp.prevMonthTrigger, class: 'dp-nav' }, [text('‹')]),
              span({ class: 'dp-title' }, [
                text((s: State) => {
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
                  return `${months[s.datePicker.visibleMonth - 1]} ${s.datePicker.visibleYear}`
                }),
              ]),
              button({ ...dp.nextMonthTrigger, class: 'dp-nav' }, [text('›')]),
            ]),
            div({ ...dp.grid, class: 'dp-grid' }, dpGrid()),
          ]),
          div({ class: 'mt-3 text-sm text-slate-600' }, [
            text('Selected: '),
            text((s: State) => s.datePicker.value ?? 'none'),
          ]),
        ]),
        card('Time Picker', [
          div({ ...tp.root, class: 'tp-root' }, [
            input({ ...tp.hoursInput, class: 'tp-input' }),
            span({ class: 'tp-sep' }, [text(':')]),
            input({ ...tp.minutesInput, class: 'tp-input' }),
            button({ ...tp.periodTrigger, class: 'tp-period' }, [
              text((s: State) => (s.timePicker.value.hours >= 12 ? 'PM' : 'AM')),
            ]),
          ]),
          div({ class: 'mt-3 text-sm text-slate-600' }, [
            text('Time: '),
            text((s: State) => formatTime(s.timePicker)),
          ]),
        ]),
        card('Color Picker', [
          div({ ...cp.root, class: 'cp-root' }, [
            div({ class: 'cp-row' }, [
              div({ ...cp.swatch, class: 'cp-swatch' }, []),
              input({ ...cp.hexInput, class: 'cp-hex' }),
            ]),
            div({ class: 'cp-sliders' }, [
              label({ class: 'cp-label' }, [
                span({}, [text('H')]),
                input({ ...cp.hueSlider, class: 'cp-range' }),
              ]),
              label({ class: 'cp-label' }, [
                span({}, [text('S')]),
                input({ ...cp.saturationSlider, class: 'cp-range' }),
              ]),
              label({ class: 'cp-label' }, [
                span({}, [text('L')]),
                input({ ...cp.lightnessSlider, class: 'cp-range' }),
              ]),
            ]),
          ]),
        ]),
      ]),
      sectionGroup('Inline editing', [
        card('Editable', [
          div({ ...ed.root, class: 'editable' }, [
            span({ ...previewParts, class: 'editable-preview' }, [
              text((s: State) => s.editable.value || 'Click to edit'),
            ]),
            input({ ...ed.input, class: 'editable-input' }),
          ]),
          div({ class: 'mt-2 text-xs text-slate-500' }, [
            text('Click, edit, Enter to commit, Esc to cancel'),
          ]),
        ]),
        card('Clipboard', [
          div({ ...cb.root, class: 'clip-root' }, [
            input({ ...cb.input, class: 'clip-input' }),
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
              [text((s: State) => (s.clipboard.copied ? 'Copied!' : 'Copy'))],
            ),
          ]),
        ]),
        card('File Upload', [
          div({ ...fu.root, class: 'fu-root' }, [
            div({ ...fu.dropzone, class: 'fu-dropzone' }, [
              text('Drag files here or click to browse'),
              input({ ...fu.hiddenInput }),
            ]),
            div({ class: 'fu-list' }, [
              ...each({
                items: (s) => s.fileUpload.files,
                key: (f) => f.name,
                render: ({ item }) => [
                  div({ class: 'fu-item' }, [
                    text(() => item.name()),
                    text(' ('),
                    text(() => `${Math.round(item.size() / 1024)}kb`),
                    text(')'),
                  ]),
                ],
              }),
            ]),
          ]),
        ]),
        card('Splitter', [
          div({ ...sp.root, class: 'split-root' }, [
            div({ ...sp.primaryPanel, class: 'split-pane' }, [text('Left pane')]),
            div({ ...sp.resizeTrigger, class: 'split-handle' }, []),
            div({ ...sp.secondaryPanel, class: 'split-pane' }, [text('Right pane')]),
          ]),
          div({ class: 'mt-2 text-xs text-slate-500' }, [
            text('Drag handle or arrow keys — split at '),
            text((s: State) => `${s.splitter.position}%`),
          ]),
        ]),
      ]),
    ]
  },
})

export function mount(container: HTMLElement): void {
  mountApp(container, App)
}
