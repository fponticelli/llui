/**
 * Registry renderer for the specialized-tools family (#266).
 *
 * Every adapter renders ONE typed case through the REAL machine -> connect ->
 * the COPIED registry skins (`registry/llui/ui/*`), exactly as an `llui add`
 * consumer composes them. It reads the same catalog
 * (`specialized-tools-scenarios.ts`) and the same initial states
 * (`specialized-tools-states.ts`) as the baseline renderer, and imports
 * NOTHING from the baseline path — no baseline stylesheet, no baseline
 * renderer — so the two styling paths cannot leak into each other
 * (`specialized-tools-isolation.test.ts` pins that).
 *
 * Icons come through `specialized-tools-frozen-icons.ts`, a frozen local
 * Iconify source, so the gallery needs no live network.
 */
import {
  canvas,
  component,
  div,
  each,
  img,
  li,
  mountApp,
  onMount,
  option,
  p,
  span,
  table,
  tbody,
  text,
  thead,
  ul,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import {
  resolveScenarioSelection,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import * as asyncList from '../../packages/components/src/components/async-list.js'
import * as cascadeSelect from '../../packages/components/src/components/cascade-select.js'
import * as clipboard from '../../packages/components/src/components/clipboard.js'
import * as colorPicker from '../../packages/components/src/components/color-picker.js'
import * as dateInput from '../../packages/components/src/components/date-input.js'
import * as datePicker from '../../packages/components/src/components/date-picker.js'
import * as editable from '../../packages/components/src/components/editable.js'
import * as fileUpload from '../../packages/components/src/components/file-upload.js'
import * as floatingPanel from '../../packages/components/src/components/floating-panel.js'
import * as gradientPicker from '../../packages/components/src/components/gradient-picker.js'
import * as imageCropper from '../../packages/components/src/components/image-cropper.js'
import * as qrCode from '../../packages/components/src/components/qr-code.js'
import * as scrollArea from '../../packages/components/src/components/scroll-area.js'
import * as signaturePad from '../../packages/components/src/components/signature-pad.js'
import * as sortable from '../../packages/components/src/components/sortable.js'
import * as splitter from '../../packages/components/src/components/splitter.js'
import * as timePicker from '../../packages/components/src/components/time-picker.js'
import * as timer from '../../packages/components/src/components/timer.js'
import * as tour from '../../packages/components/src/components/tour.js'
import * as wizard from '../../packages/components/src/patterns/wizard.js'
import { AspectRatio } from '../llui/ui/aspect-ratio'
import {
  AsyncList,
  AsyncListErrorText,
  AsyncListLoadMoreTrigger,
  AsyncListRetryTrigger,
  AsyncListSentinel,
} from '../llui/ui/async-list'
import { Button } from '../llui/ui/button'
import {
  Calendar,
  CalendarCaption,
  CalendarCaptionLabel,
  CalendarDay,
  CalendarDayButton,
  CalendarGrid,
  CalendarMonth,
  CalendarMonths,
  CalendarNav,
  CalendarNext,
  CalendarPrevious,
  CalendarRow,
  CalendarWeekday,
  CalendarWeekdays,
} from '../llui/ui/calendar'
import {
  CascadeSelect,
  CascadeSelectClearTrigger,
  CascadeSelectLabel,
  CascadeSelectLevel,
} from '../llui/ui/cascade-select'
import {
  Clipboard,
  ClipboardIndicator,
  ClipboardInput,
  ClipboardTrigger,
} from '../llui/ui/clipboard'
import {
  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerAreaCanvas,
  ColorPickerAreaThumb,
  ColorPickerHexInput,
  ColorPickerHueSlider,
  ColorPickerModelToggle,
  ColorPickerPreview,
  ColorPickerSwatch,
  ColorPickerSwatchGroup,
} from '../llui/ui/color-picker'
import {
  DateInput,
  DateInputClearTrigger,
  DateInputControl,
  DateInputErrorText,
} from '../llui/ui/date-input'
import { DatePickerTrigger } from '../llui/ui/date-picker'
import {
  Editable,
  EditableCancelTrigger,
  EditableInput,
  EditablePreview,
  EditableSubmitTrigger,
} from '../llui/ui/editable'
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadHiddenInput,
  FileUploadItem,
  FileUploadItemDeleteTrigger,
  FileUploadItemErrorText,
  FileUploadItemGroup,
  FileUploadItemName,
  FileUploadItemProgress,
  FileUploadItemProgressRange,
  FileUploadItemRetryTrigger,
  FileUploadItemSizeText,
  FileUploadLabel,
  FileUploadTrigger,
} from '../llui/ui/file-upload'
import {
  FloatingPanel,
  FloatingPanelCloseTrigger,
  FloatingPanelContent,
  FloatingPanelDragHandle,
  FloatingPanelMaximizeTrigger,
  FloatingPanelMinimizeTrigger,
  FloatingPanelResizeHandle,
} from '../llui/ui/floating-panel'
import {
  GradientPicker,
  GradientPickerAddStopButton,
  GradientPickerCssInput,
  GradientPickerKindToggle,
  GradientPickerPreview,
  GradientPickerRemoveStopButton,
  GradientPickerStop,
  GradientPickerTrack,
} from '../llui/ui/gradient-picker'
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  icon,
  MinusIcon,
  SearchIcon,
  XIcon,
} from '../llui/ui/icons'
import {
  ImageCropper,
  ImageCropperCropBox,
  ImageCropperImage,
  ImageCropperResetTrigger,
  ImageCropperResizeHandle,
} from '../llui/ui/image-cropper'
import {
  QrCode,
  QrCodeBackground,
  QrCodeDownloadTrigger,
  QrCodeForeground,
  QrCodeSvg,
} from '../llui/ui/qr-code'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../llui/ui/resizable'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../llui/ui/scroll-area'
import {
  SignaturePad,
  SignaturePadClearTrigger,
  SignaturePadControl,
  SignaturePadGuide,
  SignaturePadHiddenInput,
  SignaturePadUndoTrigger,
} from '../llui/ui/signature-pad'
import { Sortable, SortableHandle, SortableItem } from '../llui/ui/sortable'
import { Steps, StepsItem, StepsSeparator, StepsTrigger } from '../llui/ui/steps'
import {
  TimePicker,
  TimePickerPeriodTrigger,
  TimePickerSegment,
  TimePickerSeparator,
} from '../llui/ui/time-picker'
import {
  Timer,
  TimerDisplay,
  TimerPauseTrigger,
  TimerResetTrigger,
  TimerStartTrigger,
} from '../llui/ui/timer'
import {
  Tour,
  TourBackdrop,
  TourCloseTrigger,
  TourDescription,
  TourNextTrigger,
  TourPrevTrigger,
  TourProgressText,
  TourSpotlight,
  TourTitle,
} from '../llui/ui/tour'
import {
  applicableSpecializedToolsScenarios,
  joinSpecializedToolsScenarios,
  type AspectRatioCaseInput,
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
  type IconsCaseInput,
  type ImageCropperCaseInput,
  type QrCodeCaseInput,
  type ScrollAreaCaseInput,
  type SignaturePadCaseInput,
  type SortableCaseInput,
  type SpecializedToolsCatalog,
  type SpecializedToolsDefinitions,
  type SpecializedToolsJoinedScenario,
  type SpecializedToolsScenarioId,
  type SplitterCaseInput,
  type TimePickerCaseInput,
  type TimerCaseInput,
  type TourCaseInput,
  type WizardCaseInput,
} from '../../packages/components/test/styles/specialized-tools-scenarios'
import {
  asyncListInit,
  cascadeSelectInit,
  clipboardInit,
  colorPickerInit,
  dateInputInit,
  datePickerInit,
  editableInit,
  fileUploadInit,
  floatingPanelInit,
  gradientPickerInit,
  imageCropperInit,
  qrCodeInit,
  scrollAreaInit,
  signaturePadInit,
  SORTABLE_CONTAINER,
  sortableInit,
  sortableItemId,
  splitterInit,
  timePickerInit,
  timerInit,
  tourInit,
  wizardInit,
} from '../../packages/components/test/styles/specialized-tools-states'
import {
  croppableImageSrc,
  formatBytes,
  mmss,
  strokePath,
  TOUR_CARD_POSITION,
  TOUR_TARGET_BOX,
} from '../../packages/components/test/styles/specialized-tools-fixtures'
import { svg, path } from '@llui/dom'
import { installFrozenIconify } from './specialized-tools-frozen-icons'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: SpecializedToolsScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
  /** The copied artifacts this case supports (all of the product's when absent). */
  readonly copiedArtifactNames: readonly string[] | undefined
}

export type Adapter<Input> = (host: HTMLElement, data: Input, ctx: RenderContext) => Disposable

function applyEnvironmentAttrs(
  host: HTMLElement,
  environment: PresentationScenarioEnvironment,
): void {
  host.setAttribute('dir', environment.direction)
  host.dataset.theme = environment.theme
  host.dataset.viewport = environment.viewport
  host.dataset.forcedColors = environment.forcedColors
  host.dataset.motion = environment.motion
}

function mountMachine<S, M extends { type: string }>(
  host: HTMLElement,
  ctx: RenderContext,
  name: string,
  initial: () => S,
  update: (state: S, msg: M) => [S, unknown[]],
  view: (state: Signal<S>, send: Send<M>) => Mountable | readonly Mountable[],
): Disposable {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<S, M, never>({
      name,
      init: () => [initial(), []],
      update: (state, msg) => [update(state, msg)[0], []],
      view: ({ state, send }) => {
        const rendered = view(state, send)
        return Array.isArray(rendered) ? rendered : [rendered]
      },
    }),
  )
}

/** Keep a fixed-position product (panel, tour) inside its case frame. */
function containFixed(host: HTMLElement, height: string): void {
  host.style.position = 'relative'
  host.style.transform = 'translateZ(0)'
  host.style.height = height
  host.style.overflow = 'hidden'
}

const CopyIcon = icon('lucide:copy')
const UploadIcon = icon('lucide:upload')
const MaximizeIcon = icon('lucide:maximize-2')

// ─── Adapters ──────────────────────────────────────────────────────────────

const asyncListAdapter: Adapter<AsyncListCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryAsyncListScenario',
    () => asyncListInit(data),
    asyncList.update<string>,
    (state, send) => {
      const parts = asyncList.connect<string>(state, send)
      return AsyncList({ ...parts.root }, [
        ul({ class: 'ms-5 list-disc text-sm' }, [
          each(state.at('items'), {
            key: (item: string) => item,
            render: (item: Signal<string>) => [li([text(item)])],
          }),
        ]),
        AsyncListErrorText({ ...parts.errorText }, [text(state.map((s) => s.error ?? ''))]),
        AsyncListRetryTrigger({ ...parts.retryTrigger }, [text('Retry')]),
        AsyncListLoadMoreTrigger({ ...parts.loadMoreTrigger }, [
          text(state.map((s) => (s.status === 'loading' ? 'Loading…' : 'Load more'))),
        ]),
        AsyncListSentinel({ ...parts.sentinel }),
      ])
    },
  )

const cascadeSelectAdapter: Adapter<CascadeSelectCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryCascadeSelectScenario',
    () => cascadeSelectInit(data),
    cascadeSelect.update,
    (state, send) => {
      const parts = cascadeSelect.connect(state, send, { id: `registry-cascade-${ctx.caseId}` })
      return CascadeSelect({ ...parts.root }, [
        ...data.levels.map((level, index) => {
          const levelParts = parts.level(index)
          return div([
            CascadeSelectLabel({ ...levelParts.label }, [text(level.label)]),
            CascadeSelectLevel({ ...levelParts.select }, [
              option({ value: '' }, [text(`Choose ${level.label.toLowerCase()}`)]),
              ...level.options.map((o) => option({ value: o.value }, [text(o.label)])),
            ]),
          ])
        }),
        CascadeSelectClearTrigger({ ...parts.clearTrigger }, [text('Clear')]),
      ])
    },
  )

const clipboardAdapter: Adapter<ClipboardCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryClipboardScenario',
    () => clipboardInit(data),
    clipboard.update,
    (state, send) => {
      const parts = clipboard.connect(state, send)
      return Clipboard({ ...parts.root }, [
        ClipboardInput({ ...parts.input }),
        ClipboardTrigger({ ...parts.trigger }, [
          CheckIcon({ class: state.map((s) => (s.copied ? '' : 'hidden')) }),
          CopyIcon({ class: state.map((s) => (s.copied ? 'hidden' : '')) }),
        ]),
        ClipboardIndicator({ ...parts.indicator }, [
          text(
            state.map((s) =>
              s.copied
                ? 'Copied'
                : s.failed
                  ? 'Copy was blocked. Select the text and copy it manually.'
                  : '',
            ),
          ),
        ]),
      ])
    },
  )

const colorPickerAdapter: Adapter<ColorPickerCaseInput> = (host, data, ctx) => {
  const canvasId = `registry-color-picker-canvas-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'RegistryColorPickerScenario',
    () => colorPickerInit(data),
    colorPicker.update,
    (state, send) => {
      const parts = colorPicker.connect(state, send)
      return [
        ...colorPicker.areaCanvasBinding(state, canvasId),
        ColorPicker({ ...parts.root }, [
          div({ class: 'flex items-center gap-2' }, [
            ColorPickerPreview({ ...parts.preview }, []),
            ColorPickerHexInput({ ...parts.hexInput }),
            ColorPickerModelToggle({ ...parts.modelToggle }, [
              text(state.map((s) => (s.color.model === 'hsv' ? 'OKLCH' : 'HSV'))),
            ]),
          ]),
          ColorPickerArea({ ...parts.area }, [
            ColorPickerAreaCanvas({ ...parts.areaCanvas, id: canvasId, width: 240, height: 128 }),
            ColorPickerAreaThumb({ ...parts.areaThumb }, []),
          ]),
          ColorPickerHueSlider({ ...parts.hueSlider }),
          ColorPickerAlphaSlider({ ...parts.alphaSlider }),
          ColorPickerSwatchGroup(
            { ...parts.swatchGroup },
            data.swatches.map((swatch) => ColorPickerSwatch({ ...parts.swatch(swatch) })),
          ),
        ]),
      ]
    },
  )
}

const DATE_INPUT_ERRORS: Readonly<Record<string, string>> = {
  invalid: 'Enter a real date as YYYY-MM-DD.',
  'before-min': 'Choose a date on or after the earliest allowed date.',
  'after-max': 'Choose a date on or before the latest allowed date.',
}

const dateInputAdapter: Adapter<DateInputCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryDateInputScenario',
    () => dateInputInit(data),
    dateInput.update,
    (state, send) => {
      const parts = dateInput.connect(state, send, { placeholder: 'YYYY-MM-DD' })
      return DateInput({ ...parts.root }, [
        DateInputControl({ ...parts.input }),
        DateInputClearTrigger({ ...parts.clearTrigger }, [XIcon()]),
        DateInputErrorText({ ...parts.errorText }, [
          text(state.map((s) => (s.error === null ? '' : (DATE_INPUT_ERRORS[s.error] ?? '')))),
        ]),
      ])
    },
  )

const datePickerAdapter: Adapter<DatePickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryDatePickerScenario',
    () => datePickerInit(data),
    datePicker.update,
    (state, send) => {
      const parts = datePicker.connect(state, send, { mode: data.mode, locale: data.locale })
      const weekdays = datePicker.weekdayLabels(data.weekStartsOn, data.locale)
      const withTrigger = ctx.copiedArtifactNames?.includes('date-picker') ?? true
      const month = (offset: number): Mountable => {
        const grid = parts.grid(offset)
        return CalendarMonth([
          CalendarCaption([CalendarCaptionLabel([text(grid['aria-label'])])]),
          CalendarGrid({ ...grid, class: 'w-full' }, [
            thead([
              CalendarWeekdays(
                { ...parts.row },
                weekdays.map((day) => CalendarWeekday([text(day)])),
              ),
            ]),
            tbody([
              each(
                state.map((s) => datePicker.weekRows(datePicker.monthGrid(s, offset))),
                {
                  key: (week: datePicker.DayCell[]) => week[0]?.iso ?? '',
                  render: (week: Signal<datePicker.DayCell[]>) => [
                    CalendarRow(
                      { ...parts.row },
                      week
                        .peek()
                        .map((cell) =>
                          CalendarDay({ ...parts.dayCell(cell).cell }, [
                            CalendarDayButton({ type: 'button', tabindex: -1 }, [
                              text(String(cell.day)),
                            ]),
                          ]),
                        ),
                    ),
                  ],
                },
              ),
            ]),
          ]),
        ])
      }
      return div({ class: 'flex flex-col items-start gap-2' }, [
        ...(withTrigger
          ? [
              DatePickerTrigger(
                {
                  'data-empty': state.map((s) =>
                    s.value === null && s.start === null ? 'true' : undefined,
                  ),
                },
                [
                  text(
                    state.map((s) =>
                      s.mode === 'range'
                        ? s.start === null
                          ? 'Pick a date range'
                          : `${s.start} – ${s.end ?? '…'}`
                        : (s.value ?? 'Pick a date'),
                    ),
                  ),
                ],
              ),
            ]
          : []),
        Calendar(
          {
            ...parts.root,
            class: `rounded-md border${data.density === 'compact' ? ' [--cell-size:--spacing(7)]' : ''}`,
          },
          [
            CalendarMonths([
              CalendarNav([
                CalendarPrevious({ ...parts.prevMonthTrigger }, [
                  ChevronLeftIcon({ class: 'size-4' }),
                ]),
                CalendarNext({ ...parts.nextMonthTrigger }, [
                  ChevronRightIcon({ class: 'size-4' }),
                ]),
              ]),
              ...Array.from({ length: data.months }, (_, offset) => month(offset)),
            ]),
          ],
        ),
      ])
    },
  )

const editableAdapter: Adapter<EditableCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryEditableScenario',
    () => editableInit(data),
    editable.update,
    (state, send) => {
      const parts = editable.connect(state, send)
      return Editable({ ...parts.root }, [
        EditablePreview({ ...parts.preview }, [
          text(state.map((s) => (s.value === '' ? data.placeholder : s.value))),
        ]),
        EditableInput({ ...parts.input, placeholder: data.placeholder }),
        EditableSubmitTrigger({ ...parts.submitTrigger }, [text('Save')]),
        EditableCancelTrigger({ ...parts.cancelTrigger }, [text('Cancel')]),
      ])
    },
  )

const fileUploadAdapter: Adapter<FileUploadCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryFileUploadScenario',
    () => fileUploadInit(data),
    fileUpload.update,
    (state, send) => {
      const parts = fileUpload.connect(state, send, { id: `registry-file-upload-${ctx.caseId}` })
      return FileUpload({ ...parts.root }, [
        FileUploadLabel({ ...parts.label }, [text('Attachments')]),
        FileUploadDropzone({ ...parts.dropzone }, [
          UploadIcon(),
          span([text('Drop files here or')]),
          FileUploadTrigger({ ...parts.trigger }, [text('Browse files')]),
          FileUploadHiddenInput({ ...parts.hiddenInput }),
        ]),
        FileUploadItemGroup({ ...parts.itemGroup }, [
          each(state.at('files'), {
            key: (file: fileUpload.FileMeta) => file.id,
            render: (file: Signal<fileUpload.FileMeta>, index: Signal<number>) => {
              const item = parts.item(index.peek())
              const id = file.peek().id
              return [
                FileUploadItem({ ...item.item }, [
                  FileUploadItemName({ ...item.itemName }, [text(file.at('name'))]),
                  FileUploadItemSizeText({ ...item.itemSizeText }, [
                    text(file.at('size').map(formatBytes)),
                  ]),
                  FileUploadItemDeleteTrigger({ ...item.itemDeleteTrigger }, [XIcon()]),
                  FileUploadItemProgress({ ...item.itemProgress }, [
                    FileUploadItemProgressRange({ ...item.itemProgressRange }),
                  ]),
                  FileUploadItemErrorText({ ...item.itemErrorText }, [
                    text(state.map((s) => fileUpload.uploadOf(s, id)?.error ?? '')),
                  ]),
                  FileUploadItemRetryTrigger({ ...item.itemRetryTrigger }, [text('Retry')]),
                ]),
              ]
            },
          }),
        ]),
        p({ role: 'status', class: 'text-xs text-destructive' }, [
          text(
            state.map((s) =>
              s.rejectedFiles.map((r) => `${r.file.name} is not an accepted file type.`).join(' '),
            ),
          ),
        ]),
      ])
    },
  )

const floatingPanelAdapter: Adapter<FloatingPanelCaseInput> = (host, data, ctx) => {
  containFixed(host, '22rem')
  return mountMachine(
    host,
    ctx,
    'RegistryFloatingPanelScenario',
    () => floatingPanelInit(data),
    floatingPanel.update,
    (state, send) => {
      const parts = floatingPanel.connect(state, send, { label: data.title })
      return FloatingPanel({ ...parts.root }, [
        FloatingPanelDragHandle({ ...parts.dragHandle }, [
          span({ class: 'flex-1' }, [text(data.title)]),
          FloatingPanelMinimizeTrigger({ ...parts.minimizeTrigger }, [MinusIcon()]),
          FloatingPanelMaximizeTrigger({ ...parts.maximizeTrigger }, [MaximizeIcon()]),
          FloatingPanelCloseTrigger({ ...parts.closeTrigger }, [XIcon()]),
        ]),
        FloatingPanelContent({ ...parts.content }, [text(data.body)]),
        ...(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((handle) =>
          FloatingPanelResizeHandle({ ...parts.resizeHandle(handle) }),
        ),
      ])
    },
  )
}

const gradientPickerAdapter: Adapter<GradientPickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryGradientPickerScenario',
    () => gradientPickerInit(data),
    gradientPicker.update,
    (state, send) => {
      const parts = gradientPicker.connect(state, send, { id: `registry-gp-${ctx.caseId}` })
      return GradientPicker({ ...parts.root, class: 'flex w-full max-w-md flex-col gap-3' }, [
        GradientPickerPreview({ ...parts.preview }, []),
        GradientPickerTrack({ ...parts.track }, [
          each(state.at('stops'), {
            key: (stop: { id: string }) => stop.id,
            render: (stop: Signal<{ id: string }>) => [
              GradientPickerStop({ ...parts.stop(stop.peek().id) }, []),
            ],
          }),
        ]),
        div({ class: 'flex items-center gap-2' }, [
          GradientPickerAddStopButton({ ...parts.addStopButton }, [text('+')]),
          GradientPickerRemoveStopButton({ ...parts.removeStopButton }, [text('−')]),
          GradientPickerKindToggle({ ...parts.kindToggle('linear') }, [text('Linear')]),
          GradientPickerKindToggle({ ...parts.kindToggle('radial') }, [text('Radial')]),
          GradientPickerKindToggle({ ...parts.kindToggle('conic') }, [text('Conic')]),
        ]),
        GradientPickerCssInput({ ...parts.cssInput }),
      ])
    },
  )

const imageCropperAdapter: Adapter<ImageCropperCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryImageCropperScenario',
    () => imageCropperInit(data),
    imageCropper.update,
    (state, send) => {
      const parts = imageCropper.connect(state, send)
      // The natural size is part of the case, so the re-measuring onLoad is
      // not wired — the same choice the baseline adapter makes.
      const { onLoad: _measured, ...imageAttrs } = parts.image
      return div({ class: 'flex flex-col items-start gap-2' }, [
        ImageCropper({ ...parts.root }, [
          ImageCropperImage({
            ...imageAttrs,
            src: croppableImageSrc(data.image.width, data.image.height),
            alt: '',
          }),
          ImageCropperCropBox({ ...parts.cropBox }, [
            ...(['nw', 'ne', 'sw', 'se'] as const).map((handle) =>
              ImageCropperResizeHandle({ ...parts.resizeHandle(handle) }),
            ),
          ]),
        ]),
        ImageCropperResetTrigger({ ...parts.resetTrigger }, [text('Reset')]),
      ])
    },
  )

const qrCodeAdapter: Adapter<QrCodeCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryQrCodeScenario',
    () => qrCodeInit(data),
    qrCode.update,
    (state, send) => {
      const parts = qrCode.connect(state, send, { label: 'Component registry' })
      return QrCode({ ...parts.root }, [
        QrCodeSvg({ ...parts.svg }, [
          QrCodeBackground({ ...parts.background }),
          QrCodeForeground({ ...parts.foreground }),
        ]),
        QrCodeDownloadTrigger({ ...parts.downloadTrigger }, [text('Download')]),
      ])
    },
  )

function measureScrollArea(send: Send<scrollArea.ScrollAreaMsg>): Mountable {
  return onMount((root) => {
    const viewport = root.querySelector<HTMLElement>(
      '[data-scope="scroll-area"][data-part="viewport"]',
    )
    if (viewport === null) return
    send({
      type: 'setScroll',
      scrollTop: viewport.scrollTop,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
      scrollHeight: viewport.scrollHeight,
      clientWidth: viewport.clientWidth,
      clientHeight: viewport.clientHeight,
    })
  })
}

const scrollAreaAdapter: Adapter<ScrollAreaCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryScrollAreaScenario',
    () => scrollAreaInit(data),
    scrollArea.update,
    (state, send) => {
      const parts = scrollArea.connect(state, send)
      const lines = Array.from({ length: data.rows }, (_, index) => `Release note ${index + 1}`)
      return ScrollArea(
        { ...parts.root, class: 'h-40 w-64 rounded-md border', 'aria-label': 'Release notes' },
        [
          ScrollAreaViewport({ ...parts.viewport }, [
            ScrollAreaContent(
              { ...parts.content },
              lines.map((line) =>
                div(
                  {
                    class: data.wide
                      ? 'w-[32rem] px-3 py-1 text-sm whitespace-nowrap'
                      : 'px-3 py-1 text-sm',
                  },
                  [text(line)],
                ),
              ),
            ),
          ]),
          ScrollAreaScrollbar({ ...parts.scrollbarY }, [ScrollAreaThumb({ ...parts.thumbY })]),
          ScrollAreaScrollbar({ ...parts.scrollbarX }, [ScrollAreaThumb({ ...parts.thumbX })]),
          ScrollAreaCorner({ ...parts.corner }),
          measureScrollArea(send),
        ],
      )
    },
  )

const signaturePadAdapter: Adapter<SignaturePadCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistrySignaturePadScenario',
    () => signaturePadInit(data),
    signaturePad.update,
    (state, send) => {
      const parts = signaturePad.connect(state, send, { name: 'signature' })
      return SignaturePad({ ...parts.root }, [
        SignaturePadControl({ ...parts.control }, [
          // The consumer's share of a PARTIAL product: drawing the ink.
          svg(
            {
              class: 'size-full',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '2',
              'stroke-linecap': 'round',
              'aria-hidden': 'true',
              'data-signature-ink': '',
            },
            [
              each(state.at('strokes'), {
                key: (stroke: signaturePad.Stroke) => strokePath(stroke),
                render: (stroke: Signal<signaturePad.Stroke>) => [
                  path({ d: stroke.map(strokePath) }),
                ],
              }),
            ],
          ),
          SignaturePadGuide({ ...parts.guide }),
        ]),
        div({ class: 'flex items-center gap-2' }, [
          SignaturePadUndoTrigger({ ...parts.undoTrigger }, [text('Undo')]),
          SignaturePadClearTrigger({ ...parts.clearTrigger }, [text('Clear')]),
        ]),
        SignaturePadHiddenInput({ ...parts.hiddenInput }),
      ])
    },
  )

const sortableAdapter: Adapter<SortableCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistrySortableScenario',
    () => sortableInit(data),
    sortable.update,
    (state, send) => {
      const parts = sortable.connect(state, send, { id: SORTABLE_CONTAINER })
      return Sortable(
        { ...parts.root },
        data.items.map((item, index) =>
          SortableItem({ ...parts.item(sortableItemId(index), index) }, [
            SortableHandle({ ...parts.handle(sortableItemId(index), index) }, [GripVerticalIcon()]),
            span([text(item)]),
          ]),
        ),
      )
    },
  )

const splitterAdapter: Adapter<SplitterCaseInput> = (host, data, ctx) => {
  host.style.height = '8rem'
  return mountMachine(
    host,
    ctx,
    'RegistrySplitterScenario',
    () => splitterInit(data, ctx.environment.direction),
    splitter.update,
    (state, send) => {
      const parts = splitter.connect(state, send)
      return ResizablePanelGroup({ ...parts.root, class: 'rounded-md border' }, [
        ResizablePanel({ ...parts.primaryPanel }, [
          div({ class: 'p-3 text-sm' }, [text('Outline')]),
        ]),
        ResizableHandle({ ...parts.resizeTrigger }),
        ResizablePanel({ ...parts.secondaryPanel }, [
          div({ class: 'p-3 text-sm' }, [text('Editor')]),
        ]),
      ])
    },
  )
}

const timePickerAdapter: Adapter<TimePickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryTimePickerScenario',
    () => timePickerInit(data),
    timePicker.update,
    (state, send) => {
      const parts = timePicker.connect(state, send)
      return TimePicker({ ...parts.root }, [
        TimePickerSegment({ ...parts.hoursInput }),
        TimePickerSeparator({ 'aria-hidden': 'true' }, [text(':')]),
        TimePickerSegment({ ...parts.minutesInput }),
        TimePickerPeriodTrigger({ ...parts.periodTrigger }, [
          text(state.map((s) => timePicker.period(s))),
        ]),
      ])
    },
  )

const timerAdapter: Adapter<TimerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryTimerScenario',
    () => timerInit(data),
    timer.update,
    (state, send) => {
      const parts = timer.connect(state, send)
      return Timer({ ...parts.root }, [
        TimerDisplay({ ...parts.display }, [text(state.map((s) => mmss(timer.display(s))))]),
        TimerStartTrigger({ ...parts.startTrigger }, [text('Start')]),
        TimerPauseTrigger({ ...parts.pauseTrigger }, [text('Pause')]),
        TimerResetTrigger({ ...parts.resetTrigger }, [text('Reset')]),
      ])
    },
  )

const px = (box: Readonly<Record<string, number>>): string =>
  Object.entries(box)
    .map(([key, value]) => `${key}: ${value}px`)
    .join('; ')

const tourAdapter: Adapter<TourCaseInput> = (host, data, ctx) => {
  containFixed(host, '16rem')
  return mountMachine(
    host,
    ctx,
    'RegistryTourScenario',
    () => tourInit(data),
    tour.update,
    (state, send) => {
      const parts = tour.connect(state, send, { id: `registry-tour-${ctx.caseId}` })
      const step = data.steps[data.index]!
      return [
        div(
          {
            'data-tour-target': step.id,
            class:
              'absolute flex items-center justify-center rounded-md border border-dashed text-sm',
            style: px(TOUR_TARGET_BOX),
          },
          [text(step.title)],
        ),
        data.spotlight
          ? TourSpotlight({ ...parts.spotlight, style: px(TOUR_TARGET_BOX) })
          : TourBackdrop({ ...parts.backdrop }),
        Tour({ ...parts.root, style: px(TOUR_CARD_POSITION) }, [
          TourTitle({ ...parts.title }, [text(step.title)]),
          TourDescription({ ...parts.description }, [text(step.description)]),
          TourProgressText({ ...parts.progressText }, [
            text(`Step ${data.index + 1} of ${data.steps.length}`),
          ]),
          div({ class: 'flex justify-end gap-2' }, [
            TourPrevTrigger({ ...parts.prevTrigger }, [text('Back')]),
            TourNextTrigger({ ...parts.nextTrigger }, [
              text(state.map((s) => (s.index >= s.steps.length - 1 ? 'Done' : 'Next'))),
            ]),
          ]),
          TourCloseTrigger({ ...parts.closeTrigger }, [XIcon()]),
        ]),
      ]
    },
  )
}

const wizardAdapter: Adapter<WizardCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryWizardScenario',
    () => wizardInit(data),
    (state: wizard.WizardState, msg: wizard.WizardMsg) => wizard.update(state, msg),
    (state, send) => {
      const parts = wizard.connect(state, send, { label: 'Sign-up' })
      // COMPOSED: the steps skin draws the indicator, the Button skin the actions.
      return div({ class: 'flex flex-col gap-3' }, [
        Steps(
          { ...parts.root },
          data.steps.map((name, index) => {
            const item = parts.item(index)
            return StepsItem({ ...item.item }, [
              StepsTrigger({ ...item.trigger }, [text(`${index + 1}. ${name}`)]),
              ...(index < data.steps.length - 1 ? [StepsSeparator({ ...item.separator })] : []),
            ])
          }),
        ),
        div({ class: 'flex gap-2' }, [
          Button({ ...parts.prevTrigger, variant: 'outline', size: 'sm' }, [text('Back')]),
          Button({ ...parts.nextTrigger, size: 'sm' }, [
            text(state.map((s) => (s.validating !== null ? 'Checking…' : 'Next'))),
          ]),
        ]),
      ])
    },
  )

const aspectRatioAdapter: Adapter<AspectRatioCaseInput> = (host, data, ctx) => {
  applyEnvironmentAttrs(host, ctx.environment)
  const ratio = data.ratio === 1 ? '1/1' : '16/9'
  return mountApp(
    host,
    component<null, { type: 'none' }, never>({
      name: 'RegistryAspectRatioScenario',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () => [
        div({ class: 'w-64' }, [
          AspectRatio({ ratio, class: 'rounded-md border bg-muted' }, [
            div(
              { class: 'flex size-full items-center justify-center text-sm text-muted-foreground' },
              [text(data.label)],
            ),
          ]),
        ]),
      ],
    }),
  )
}

const GLYPH_FACTORIES = {
  Check: CheckIcon,
  ChevronDown: ChevronDownIcon,
  X: XIcon,
  Calendar: CalendarIcon,
  Search: SearchIcon,
} as const

const iconsAdapter: Adapter<IconsCaseInput> = (host, data, ctx) => {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<null, { type: 'none' }, never>({
      name: 'RegistryIconsScenario',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () => [
        div(
          { class: 'flex items-center gap-3 text-foreground' },
          data.glyphs.map((name) =>
            span({ 'data-glyph': name, class: 'inline-flex' }, [
              GLYPH_FACTORIES[name as keyof typeof GLYPH_FACTORIES]({
                class: data.sizeClass === 'large' ? 'size-8' : 'size-4',
              }),
            ]),
          ),
        ),
      ],
    }),
  )
}

/** Adapters for every product whose registry mode is visually applicable. */
export const REGISTRY_ADAPTERS = {
  'component:async-list': asyncListAdapter,
  'component:cascade-select': cascadeSelectAdapter,
  'component:clipboard': clipboardAdapter,
  'component:color-picker': colorPickerAdapter,
  'component:date-input': dateInputAdapter,
  'component:date-picker': datePickerAdapter,
  'component:editable': editableAdapter,
  'component:file-upload': fileUploadAdapter,
  'component:floating-panel': floatingPanelAdapter,
  'component:gradient-picker': gradientPickerAdapter,
  'component:image-cropper': imageCropperAdapter,
  'component:qr-code': qrCodeAdapter,
  'component:scroll-area': scrollAreaAdapter,
  'component:signature-pad': signaturePadAdapter,
  'component:sortable': sortableAdapter,
  'component:splitter': splitterAdapter,
  'component:time-picker': timePickerAdapter,
  'component:timer': timerAdapter,
  'component:tour': tourAdapter,
  'pattern:wizard': wizardAdapter,
  'registry:aspect-ratio': aspectRatioAdapter,
  'registry:icons': iconsAdapter,
} as const satisfies Partial<Record<SpecializedToolsScenarioId, Adapter<never>>>

function assertBindings(scenarios: readonly SpecializedToolsJoinedScenario[]): void {
  const expected = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bound = Object.keys(REGISTRY_ADAPTERS).sort()
  if (JSON.stringify(expected) !== JSON.stringify(bound)) {
    throw new Error(
      `Registry specialized-tools bindings do not match applicable ProductContract scenarios: expected ${expected.join(', ')}; received ${bound.join(', ')}`,
    )
  }
}

export interface MountOptions {
  readonly environment?: Partial<PresentationScenarioEnvironment>
}

export function mountRegistrySpecializedToolsScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: SpecializedToolsCatalog,
  scenarios: readonly SpecializedToolsJoinedScenario[] = applicableSpecializedToolsScenarios(
    joinSpecializedToolsScenarios(catalog, contract),
    'registryTailwind',
  ),
  options: MountOptions = {},
): Disposable {
  assertBindings(scenarios)
  const restoreIcons = installFrozenIconify()
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    for (const scenarioCase of scenario.cases) {
      const environment = Object.fromEntries(
        Object.entries(options.environment ?? {}).filter(([axis]) =>
          (scenarioCase.environmentAxes as readonly string[]).includes(axis),
        ),
      )
      const resolved = resolveScenarioSelection<SpecializedToolsDefinitions>(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'registryTailwind',
        environment,
      })
      const host = document.createElement('section')
      host.id = `registry-${scenario.productId}--${scenarioCase.id}`
      host.dataset.scenarioRenderer = 'registryTailwind'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      const adapter = REGISTRY_ADAPTERS[resolved.scenarioId as keyof typeof REGISTRY_ADAPTERS]
      handles.push(
        (adapter as Adapter<unknown>)(host, resolved.case.input, {
          scenarioId: resolved.scenarioId as SpecializedToolsScenarioId,
          caseId: resolved.case.id,
          environment: resolved.environment,
          copiedArtifactNames: Array.isArray(scenarioCase.copiedArtifactNames)
            ? (scenarioCase.copiedArtifactNames as readonly string[])
            : undefined,
        }),
      )
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
      restoreIcons()
    },
  }
}
