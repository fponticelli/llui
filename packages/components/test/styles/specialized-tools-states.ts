/**
 * Case input -> initial machine state, for every specialized-tools product
 * (#266). Shared by BOTH renderers so the baseline and registry paths render
 * the same state for the same case — the only thing that may differ between
 * them is the view. This module is renderer-neutral: it imports machines and
 * scenario data, never a renderer, a stylesheet or a registry skin.
 *
 * A state is reached the way a real session reaches it — by folding real
 * messages through the real reducer (`drive`) — and never by writing a state
 * literal that no sequence of messages could produce. The two exceptions say
 * why at their call site.
 */
import * as asyncList from '../../src/components/async-list'
import * as cascadeSelect from '../../src/components/cascade-select'
import * as clipboard from '../../src/components/clipboard'
import * as colorPicker from '../../src/components/color-picker'
import * as dateInput from '../../src/components/date-input'
import * as datePicker from '../../src/components/date-picker'
import * as editable from '../../src/components/editable'
import * as fileUpload from '../../src/components/file-upload'
import * as floatingPanel from '../../src/components/floating-panel'
import * as gradientPicker from '../../src/components/gradient-picker'
import * as imageCropper from '../../src/components/image-cropper'
import * as qrCode from '../../src/components/qr-code'
import * as scrollArea from '../../src/components/scroll-area'
import * as signaturePad from '../../src/components/signature-pad'
import * as sortable from '../../src/components/sortable'
import * as splitter from '../../src/components/splitter'
import * as timePicker from '../../src/components/time-picker'
import * as timer from '../../src/components/timer'
import * as tour from '../../src/components/tour'
import * as wizard from '../../src/patterns/wizard'
import {
  qrFixtureMatrix,
  type AsyncListCaseInput,
  type CascadeSelectCaseInput,
  type ClipboardCaseInput,
  type ColorPickerCaseInput,
  type DateInputCaseInput,
  type DatePickerCaseInput,
  type EditableCaseInput,
  type FileUploadCaseInput,
  type FloatingPanelCaseInput,
  type GradientPickerCaseInput,
  type ImageCropperCaseInput,
  type QrCodeCaseInput,
  type ScrollAreaCaseInput,
  type SignaturePadCaseInput,
  type SortableCaseInput,
  type SplitterCaseInput,
  type TimePickerCaseInput,
  type TimerCaseInput,
  type TourCaseInput,
  type WizardCaseInput,
} from './specialized-tools-scenarios'
import { fileMeta } from './specialized-tools-fixtures'

/** Fold messages through a reducer. */
export function drive<S, M>(
  state: S,
  update: (s: S, m: M) => [S, unknown[]],
  msgs: readonly M[],
): S {
  return msgs.reduce((current, msg) => update(current, msg)[0], state)
}

export function asyncListInit(data: AsyncListCaseInput): asyncList.AsyncListState<string> {
  const base = asyncList.init<string>({ items: [...data.items], hasMore: data.hasMore })
  switch (data.status) {
    case 'idle':
      return base
    case 'loading':
      return drive(base, asyncList.update<string>, [{ type: 'loadMore' }])
    case 'loaded':
      // `setItems` is the documented way to land a settled page.
      return drive(base, asyncList.update<string>, [
        { type: 'setItems', items: [...data.items], hasMore: data.hasMore },
      ])
    case 'error':
      return drive(base, asyncList.update<string>, [
        { type: 'loadMore' },
        { type: 'pageFailed', error: data.error ?? 'Request failed.' },
      ])
  }
}

export function cascadeSelectInit(data: CascadeSelectCaseInput): cascadeSelect.CascadeSelectState {
  return cascadeSelect.init({
    levels: data.levels.map((level) => ({ ...level, options: [...level.options] })),
    values: [...data.values],
    disabled: data.disabled,
  })
}

export function clipboardInit(data: ClipboardCaseInput): clipboard.ClipboardState {
  return drive(
    clipboard.init({ value: data.value }),
    clipboard.update,
    data.outcome === 'copied'
      ? [{ type: 'copy' }, { type: 'copied' }]
      : data.outcome === 'failed'
        ? [{ type: 'copy' }, { type: 'copyFailed' }]
        : [],
  )
}

export function colorPickerInit(data: ColorPickerCaseInput): colorPicker.ColorPickerState {
  return colorPicker.init({ model: data.model, color: data.color, disabled: data.disabled })
}

export function dateInputInit(data: DateInputCaseInput): dateInput.DateInputState {
  return dateInput.init({
    value: data.input === '' ? null : data.input,
    min: data.min,
    max: data.max,
    disabled: data.disabled,
    readonly: data.readonly,
    required: data.required,
  })
}

/** `today` for a date-picker case: pinned, or computed from the fixed instant. */
export function datePickerToday(data: DatePickerCaseInput): string {
  return data.timeZone !== null && data.instant !== null
    ? datePicker.todayInTimeZone(data.timeZone, data.instant)
    : data.today
}

export function datePickerInit(data: DatePickerCaseInput): datePicker.DatePickerState {
  const today = datePickerToday(data)
  const zoned = data.timeZone !== null
  return datePicker.init({
    mode: data.mode,
    value: data.value,
    start: data.start,
    end: data.end,
    visibleYear: zoned ? Number(today.slice(0, 4)) : data.visibleYear,
    visibleMonth: zoned ? Number(today.slice(5, 7)) : data.visibleMonth,
    months: data.months,
    min: data.min,
    max: data.max,
    unavailable: [...data.unavailable],
    weekStartsOn: data.weekStartsOn,
    today,
  })
}

export function editableInit(data: EditableCaseInput): editable.EditableState {
  return editable.init({ value: data.value, editing: data.editing, disabled: data.disabled })
}

export function fileUploadInit(data: FileUploadCaseInput): fileUpload.FileUploadState {
  const base = fileUpload.init({ multiple: true, files: data.fileIds.map(fileMeta) })
  const withInput = drive(base, fileUpload.update, [
    ...data.rejected.map(
      (rejected): fileUpload.FileUploadMsg => ({
        type: 'addFiles',
        files: [],
        customRejected: [
          {
            file: {
              id: `rejected-${rejected.name}`,
              name: rejected.name,
              size: 0,
              type: '',
              lastModified: 0,
            },
            errors: [{ code: rejected.code }],
          },
        ],
      }),
    ),
    ...(data.invalid ? [{ type: 'setInvalid', invalid: true } as const] : []),
    ...(data.dragging ? [{ type: 'dragEnter' } as const] : []),
    ...data.uploads.flatMap((upload): fileUpload.FileUploadMsg[] =>
      upload.status === 'uploading'
        ? [{ type: 'uploadProgress', id: upload.id, progress: upload.progress }]
        : upload.status === 'done'
          ? [{ type: 'uploadSucceeded', id: upload.id }]
          : [
              { type: 'uploadProgress', id: upload.id, progress: upload.progress },
              { type: 'uploadFailed', id: upload.id, error: upload.error ?? 'Upload failed.' },
            ],
    ),
  ])
  // `disabled` is an init option with no message; applied last so the
  // messages above were not refused by it.
  return data.disabled ? { ...withInput, disabled: true } : withInput
}

export function floatingPanelInit(data: FloatingPanelCaseInput): floatingPanel.FloatingPanelState {
  const base = floatingPanel.init({
    position: { x: 16, y: 16 },
    size: { width: data.width, height: data.height },
    minSize: { width: 200, height: 120 },
    maxSize: { width: 480, height: 320 },
  })
  return drive(base, floatingPanel.update, [
    ...(data.minimized ? [{ type: 'minimize' } as const] : []),
    ...(data.maximized ? [{ type: 'maximize' } as const] : []),
    ...(data.atMinimum ? [{ type: 'resizeBy', handle: 'se', dx: -1000, dy: -1000 } as const] : []),
  ])
}

export function gradientPickerInit(
  data: GradientPickerCaseInput,
): gradientPicker.GradientPickerState {
  return gradientPicker.init({ css: data.css, disabled: data.disabled })
}

export function imageCropperInit(data: ImageCropperCaseInput): imageCropper.ImageCropperState {
  const base = imageCropper.init({
    image: { ...data.image },
    aspectRatio: data.aspectRatio,
    ...(data.crop === null ? {} : { crop: { ...data.crop } }),
  })
  const driven = drive(base, imageCropper.update, [
    ...Array.from({ length: data.zoomSteps }, () => ({ type: 'zoom', factor: 1.1 }) as const),
    ...(data.dragging ? [{ type: 'dragStart' } as const] : []),
  ])
  // `disabled` is an init option with no message (and would refuse the zoom).
  return data.disabled ? { ...driven, disabled: true } : driven
}

export function qrCodeInit(data: QrCodeCaseInput): qrCode.QrCodeState {
  return qrCode.init({ value: data.value, matrix: qrFixtureMatrix(data.rows) })
}

export function scrollAreaInit(data: ScrollAreaCaseInput): scrollArea.ScrollAreaState {
  return scrollArea.init({ visibility: data.visibility })
}

export function signaturePadInit(data: SignaturePadCaseInput): signaturePad.SignaturePadState {
  const base = signaturePad.init({
    strokes: data.strokes.map((stroke) => stroke.map((point) => ({ ...point }))),
    disabled: data.disabled,
    readonly: data.readonly,
  })
  return data.clearedThenRestorable ? drive(base, signaturePad.update, [{ type: 'clear' }]) : base
}

export const SORTABLE_CONTAINER = 'specialized-tools-sortable'

export const sortableItemId = (index: number): string => `task-${index}`

export function sortableInit(data: SortableCaseInput): sortable.SortableState {
  if (data.drag !== null) {
    return drive(sortable.init(), sortable.update, [
      {
        type: 'start',
        id: sortableItemId(data.drag.from),
        index: data.drag.from,
        container: SORTABLE_CONTAINER,
        x: 0,
        y: 0,
      },
      { type: 'move', index: data.drag.to, container: SORTABLE_CONTAINER, x: 0, y: 48 },
    ])
  }
  if (data.keyboardGrab !== null) {
    return drive(sortable.init(), sortable.update, [
      {
        type: 'toggleGrab',
        id: sortableItemId(data.keyboardGrab),
        index: data.keyboardGrab,
        container: SORTABLE_CONTAINER,
      },
    ])
  }
  return sortable.init()
}

export function splitterInit(data: SplitterCaseInput, dir: 'ltr' | 'rtl'): splitter.SplitterState {
  return splitter.init({
    orientation: data.orientation,
    position: data.position,
    min: data.min,
    max: data.max,
    disabled: data.disabled,
    dir,
  })
}

export function timePickerInit(data: TimePickerCaseInput): timePicker.TimePickerState {
  return timePicker.init({
    value: { hours: data.hours, minutes: data.minutes, seconds: 0 },
    format: data.format,
    disabled: data.disabled,
  })
}

export function timerInit(data: TimerCaseInput): timer.TimerState {
  const base = timer.init({
    direction: data.direction,
    targetMs: data.targetMs,
    elapsedMs: data.elapsedMs,
  })
  // `start` needs an instant; the literal 0 keeps the case clock-free.
  return data.running ? drive(base, timer.update, [{ type: 'start', now: 0 }]) : base
}

export function tourInit(data: TourCaseInput): tour.TourState {
  return tour.init({
    steps: data.steps.map((step) => ({
      ...step,
      target: `[data-tour-target="${step.id}"]`,
      spotlight: data.spotlight,
    })),
    open: true,
    index: data.index,
  })
}

export function wizardInit(data: WizardCaseInput): wizard.WizardState {
  const base = wizard.init({
    steps: [...data.steps],
    current: data.current,
    completed: [...data.completed],
  })
  // `validating` is what `next` sets while an ASYNC validator runs; reaching it
  // through `next` would need a validator effect to be in flight, so the
  // pending step is written directly — the same field the reducer writes.
  return data.validating ? { ...base, validating: data.current } : base
}
