/**
 * Baseline renderer for the specialized-tools family (#266).
 *
 * Every adapter renders ONE typed case through the REAL machine -> connect ->
 * baseline parts, with no class and no inline style on any part: the only
 * styling is `theme.css`. The one exception is a machine that writes its own
 * inline geometry (floating panel, crop box, thumbs, panels), plus the
 * consumer's documented share of a PARTIAL product — the tour card's position
 * — and the documented density override. Plain layout wrappers (non-part
 * elements) carry inline flex layout, exactly as an app's own markup would.
 *
 * Initial states come from `specialized-tools-states.ts`, which the registry
 * renderer shares, so both paths render the SAME state for a case and only
 * the view differs. Pictures come from `specialized-tools-fixtures.ts`.
 * Nothing here reads a clock, draws a random value or touches the network.
 */
import {
  button,
  canvas,
  component,
  div,
  each,
  img,
  input,
  label,
  li,
  mountApp,
  onMount,
  option,
  p,
  path,
  rect,
  select,
  span,
  svg,
  text,
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
import * as asyncList from '../../src/components/async-list'
import * as cascadeSelect from '../../src/components/cascade-select'
import * as clipboard from '../../src/components/clipboard'
import * as colorPicker from '../../src/components/color-picker'
import * as dateInput from '../../src/components/date-input'
import * as datePicker from '../../src/components/date-picker'
import * as editable from '../../src/components/editable'
import * as fileUpload from '../../src/components/file-upload'
import { floatingPanelPointerWiring, splitterPointerWiring } from './pointer-wiring'
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
  applicableSpecializedToolsScenarios,
  joinSpecializedToolsScenarios,
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
  type SpecializedToolsCatalog,
  type SpecializedToolsDefinitions,
  type SpecializedToolsJoinedScenario,
  type SpecializedToolsScenarioId,
  type SplitterCaseInput,
  type TimePickerCaseInput,
  type TimerCaseInput,
  type TourCaseInput,
  type WizardCaseInput,
} from './specialized-tools-scenarios'
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
  sortableScenarioInit,
  sortableScenarioUpdate,
  splitterInit,
  timePickerInit,
  timerInit,
  tourInit,
  wizardInit,
} from './specialized-tools-states'
import {
  croppableImageSrc,
  formatBytes,
  mmss,
  strokePath,
  TOUR_CARD_POSITION,
  TOUR_TARGET_BOX,
} from './specialized-tools-fixtures'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: SpecializedToolsScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

export type Adapter<Input> = (host: HTMLElement, data: Input, ctx: RenderContext) => Disposable

/** The resolved environment, applied to the case host the way an app applies
 * it from an ancestor (`dir`, `data-theme`, …). */
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

/**
 * A fixed-position product (floating panel, tour) must stay inside its case
 * frame in a gallery. `transform` makes the host the containing block for
 * `position: fixed` descendants, so the product renders where the case is.
 */
function containFixed(host: HTMLElement, height: string): void {
  host.style.position = 'relative'
  host.style.transform = 'translateZ(0)'
  host.style.height = height
  host.style.overflow = 'hidden'
}

/** App-owned layout around parts: a plain wrapper, never a part. */
const row = (children: readonly Mountable[], extra = ''): Mountable =>
  div({ style: `display: flex; align-items: center; gap: 0.5rem; ${extra}` }, children)

// ─── Consumer-owned glyphs (the baseline ships no icon set) ─────────────────

const GLYPHS = {
  copy: 'M8 8h12v12H8zM4 16V4h12',
  x: 'M18 6 6 18M6 6l12 12',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  upload: 'M12 3v12m-5-5 5-5 5 5M5 21h14',
  minimize: 'M5 12h14',
  maximize: 'M4 4h16v16H4z',
} as const

function glyph(name: keyof typeof GLYPHS): Mountable {
  return svg(
    {
      viewBox: '0 0 24 24',
      width: '16',
      height: '16',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    [path({ d: GLYPHS[name] })],
  )
}

// ─── Adapters ──────────────────────────────────────────────────────────────

const asyncListAdapter: Adapter<AsyncListCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineAsyncListScenario',
    () => asyncListInit(data),
    asyncList.update<string>,
    (state, send) => {
      const parts = asyncList.connect<string>(state, send)
      return div({ ...parts.root }, [
        ul({ style: 'margin: 0; padding-inline-start: 1.25rem' }, [
          each(state.at('items'), {
            key: (item: string) => item,
            render: (item: Signal<string>) => [li([text(item)])],
          }),
        ]),
        p({ ...parts.errorText }, [text(state.map((s) => s.error ?? ''))]),
        button({ ...parts.retryTrigger }, [text('Retry')]),
        button({ ...parts.loadMoreTrigger }, [
          text(state.map((s) => (s.status === 'loading' ? 'Loading…' : 'Load more'))),
        ]),
        div({ ...parts.sentinel }),
      ])
    },
  )

const cascadeSelectAdapter: Adapter<CascadeSelectCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineCascadeSelectScenario',
    () => cascadeSelectInit(data),
    cascadeSelect.update,
    (state, send) => {
      const parts = cascadeSelect.connect(state, send, { id: `baseline-cascade-${ctx.caseId}` })
      return div({ ...parts.root }, [
        ...data.levels.map((level, index) => {
          const levelParts = parts.level(index)
          return div([
            label({ ...levelParts.label }, [text(level.label)]),
            select({ ...levelParts.select }, [
              option({ value: '' }, [text(`Choose ${level.label.toLowerCase()}`)]),
              ...level.options.map((o) => option({ value: o.value }, [text(o.label)])),
            ]),
          ])
        }),
        button({ ...parts.clearTrigger }, [text('Clear')]),
      ])
    },
  )

const clipboardAdapter: Adapter<ClipboardCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineClipboardScenario',
    () => clipboardInit(data),
    clipboard.update,
    (state, send) => {
      const parts = clipboard.connect(state, send)
      return div({ ...parts.root }, [
        // The machine publishes no label part: the consumer names the field.
        input({ ...parts.input, 'aria-label': 'Value to copy' }),
        button({ ...parts.trigger }, [glyph('copy')]),
        span({ ...parts.indicator }, [
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
  const canvasId = `baseline-color-picker-canvas-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineColorPickerScenario',
    () => colorPickerInit(data),
    colorPicker.update,
    (state, send) => {
      const parts = colorPicker.connect(state, send)
      return [
        ...colorPicker.areaCanvasBinding(state, canvasId),
        div({ ...parts.root }, [
          row([
            div({ ...parts.preview }),
            input({ ...parts.hexInput }),
            button({ ...parts.modelToggle }, [
              text(state.map((s) => (s.color.model === 'hsv' ? 'OKLCH' : 'HSV'))),
            ]),
          ]),
          div({ ...parts.area }, [
            canvas({ ...parts.areaCanvas, id: canvasId, width: 240, height: 128 }),
            div({ ...parts.areaThumb }),
          ]),
          input({ ...parts.hueSlider }),
          input({ ...parts.alphaSlider }),
          div(
            { ...parts.swatchGroup },
            data.swatches.map((swatch) => button({ ...parts.swatch(swatch) })),
          ),
        ]),
      ]
    },
  )
}

export const DATE_INPUT_ERRORS: Readonly<Record<string, string>> = {
  invalid: 'Enter a real date as YYYY-MM-DD.',
  'before-min': 'Choose a date on or after the earliest allowed date.',
  'after-max': 'Choose a date on or before the latest allowed date.',
}

const dateInputAdapter: Adapter<DateInputCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineDateInputScenario',
    () => dateInputInit(data),
    dateInput.update,
    (state, send) => {
      const parts = dateInput.connect(state, send, {
        placeholder: 'YYYY-MM-DD',
        id: `baseline-date-input-${ctx.caseId}`,
      })
      return div({ ...parts.root }, [
        // The machine publishes no label part: the consumer names the field (a
        // placeholder is a hint, and the error it describes is not a name).
        input({ ...parts.input, 'aria-label': 'Date' }),
        button({ ...parts.clearTrigger }, [glyph('x')]),
        p({ ...parts.errorText }, [
          text(state.map((s) => (s.error === null ? '' : (DATE_INPUT_ERRORS[s.error] ?? '')))),
        ]),
      ])
    },
  )

const datePickerAdapter: Adapter<DatePickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineDatePickerScenario',
    () => datePickerInit(data),
    datePicker.update,
    (state, send) => {
      const parts = datePicker.connect(state, send, { mode: data.mode, locale: data.locale })
      const weekdays = datePicker.weekdayLabels(data.weekStartsOn, data.locale)
      const month = (offset: number): Mountable => {
        const grid = parts.grid(offset)
        return div({ style: 'display: flex; flex-direction: column; gap: 0.5rem' }, [
          div({ style: 'text-align: center; font-size: 0.875rem; font-weight: 500' }, [
            text(grid['aria-label']),
          ]),
          div({ ...grid }, [
            div(
              { ...parts.row },
              weekdays.map((day) => span({ role: 'columnheader' }, [text(day)])),
            ),
            each(
              state.map((s) => datePicker.weekRows(datePicker.monthGrid(s, offset))),
              {
                key: (week: datePicker.DayCell[]) => week[0]?.iso ?? '',
                // A row's key is its first date, so its cells ARE its
                // identity: snapshot them once. `dayCell` re-derives every
                // flag from live state for that date.
                render: (week: Signal<datePicker.DayCell[]>) => {
                  const cells = week.peek()
                  return [
                    div(
                      { ...parts.row },
                      cells.map((cell) =>
                        button({ ...parts.dayCell(cell).cell }, [text(String(cell.day))]),
                      ),
                    ),
                  ]
                },
              },
            ),
          ]),
        ])
      }
      return div(
        {
          ...parts.root,
          ...(data.density === 'compact' ? { style: '--llui-date-picker-cell-size: 1.75rem' } : {}),
        },
        [
          row(
            [
              button({ ...parts.prevMonthTrigger }, [glyph('chevronLeft')]),
              button({ ...parts.nextMonthTrigger }, [glyph('chevronRight')]),
            ],
            'justify-content: space-between',
          ),
          row(
            Array.from({ length: data.months }, (_, offset) => month(offset)),
            'align-items: flex-start; gap: 1rem; flex-wrap: wrap',
          ),
        ],
      )
    },
  )

const editableAdapter: Adapter<EditableCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineEditableScenario',
    () => editableInit(data),
    editable.update,
    (state, send) => {
      const parts = editable.connect(state, send)
      return div({ ...parts.root }, [
        span({ ...parts.preview }, [
          text(state.map((s) => (s.value === '' ? data.placeholder : s.value))),
        ]),
        input({ ...parts.input, placeholder: data.placeholder }),
        button({ ...parts.submitTrigger }, [text('Save')]),
        button({ ...parts.cancelTrigger }, [text('Cancel')]),
      ])
    },
  )

const fileUploadAdapter: Adapter<FileUploadCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineFileUploadScenario',
    () => fileUploadInit(data),
    fileUpload.update,
    (state, send) => {
      const parts = fileUpload.connect(state, send, { id: `baseline-file-upload-${ctx.caseId}` })
      return div({ ...parts.root }, [
        label({ ...parts.label }, [text('Attachments')]),
        div({ ...parts.dropzone }, [
          glyph('upload'),
          span([text('Drop files here or')]),
          button({ ...parts.trigger }, [text('Browse files')]),
          input({ ...parts.hiddenInput }),
        ]),
        ul({ ...parts.itemGroup }, [
          each(state.at('files'), {
            key: (file: fileUpload.FileMeta) => file.id,
            render: (file: Signal<fileUpload.FileMeta>, index: Signal<number>) => {
              const item = parts.item(index.peek())
              const id = file.peek().id
              return [
                li({ ...item.item }, [
                  p({ ...item.itemName }, [text(file.at('name'))]),
                  p({ ...item.itemSizeText }, [text(file.at('size').map(formatBytes))]),
                  button({ ...item.itemDeleteTrigger }, [glyph('x')]),
                  div({ ...item.itemProgress }, [div({ ...item.itemProgressRange })]),
                  p({ ...item.itemErrorText }, [
                    text(state.map((s) => fileUpload.uploadOf(s, id)?.error ?? '')),
                  ]),
                  button({ ...item.itemRetryTrigger }, [text('Retry')]),
                ]),
              ]
            },
          }),
        ]),
        p({ role: 'status', style: 'margin: 0; font-size: 0.75rem' }, [
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
    'BaselineFloatingPanelScenario',
    () => floatingPanelInit(data),
    floatingPanel.update,
    (state, send) => {
      const parts = floatingPanel.connect(state, send, { label: data.title })
      return [
        floatingPanelPointerWiring(send),
        div({ ...parts.root }, [
          div({ ...parts.dragHandle }, [
            span({ style: 'flex: 1' }, [text(data.title)]),
            button({ ...parts.minimizeTrigger }, [glyph('minimize')]),
            button({ ...parts.maximizeTrigger }, [glyph('maximize')]),
            button({ ...parts.closeTrigger }, [glyph('x')]),
          ]),
          div({ ...parts.content }, [text(data.body)]),
          ...(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((handle) =>
            div({ ...parts.resizeHandle(handle) }),
          ),
        ]),
      ]
    },
  )
}

const gradientPickerAdapter: Adapter<GradientPickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineGradientPickerScenario',
    () => gradientPickerInit(data),
    gradientPicker.update,
    (state, send) => {
      const parts = gradientPicker.connect(state, send, { id: `baseline-gp-${ctx.caseId}` })
      return div({ ...parts.root }, [
        div({ ...parts.preview }),
        div({ ...parts.track }, [
          each(state.at('stops'), {
            key: (stop: { id: string }) => stop.id,
            render: (stop: Signal<{ id: string }>) => {
              const id = stop.peek().id
              return [div({ ...parts.stop(id) })]
            },
          }),
        ]),
        row([
          button({ ...parts.addStopButton }, [text('+')]),
          button({ ...parts.removeStopButton }, [text('−')]),
          button({ ...parts.kindToggle('linear') }, [text('Linear')]),
          button({ ...parts.kindToggle('radial') }, [text('Radial')]),
          button({ ...parts.kindToggle('conic') }, [text('Conic')]),
        ]),
        input({ ...parts.cssInput }),
      ])
    },
  )

const imageCropperAdapter: Adapter<ImageCropperCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineImageCropperScenario',
    () => imageCropperInit(data),
    imageCropper.update,
    (state, send) => {
      const parts = imageCropper.connect(state, send)
      // The natural size is KNOWN (it is part of the case), so the image's
      // `onLoad` — which re-measures and re-centres the crop — is not wired:
      // a consumer who already knows the dimensions does the same.
      const { onLoad: _measured, ...imageAttrs } = parts.image
      return [
        div({ ...parts.root }, [
          img({
            ...imageAttrs,
            src: croppableImageSrc(data.image.width, data.image.height),
            alt: '',
          }),
          div({ ...parts.cropBox }, [
            ...(['nw', 'ne', 'sw', 'se'] as const).map((handle) =>
              div({ ...parts.resizeHandle(handle) }),
            ),
          ]),
        ]),
        button({ ...parts.resetTrigger }, [text('Reset')]),
      ]
    },
  )

const qrCodeAdapter: Adapter<QrCodeCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineQrCodeScenario',
    () => qrCodeInit(data),
    qrCode.update,
    (state, send) => {
      const parts = qrCode.connect(state, send, { label: 'Component registry' })
      return div({ ...parts.root }, [
        svg({ ...parts.svg }, [rect({ ...parts.background }), path({ ...parts.foreground })]),
        button({ ...parts.downloadTrigger }, [text('Download')]),
      ])
    },
  )

/** Measure the viewport once so the bars reflect the real overflow — the same
 * `setScroll` a scroll event sends. */
export function measureScrollArea(send: Send<scrollArea.ScrollAreaMsg>): Mountable {
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
    'BaselineScrollAreaScenario',
    () => scrollAreaInit(data),
    scrollArea.update,
    (state, send) => {
      const parts = scrollArea.connect(state, send)
      const lines = Array.from({ length: data.rows }, (_, index) => `Release note ${index + 1}`)
      // The consumer sizes the area — a scroll area has no intrinsic height.
      // The box is a GRID so the root, its one item, is stretched to a
      // DEFINITE 10rem the viewport's `height: 100%` resolves against; in a
      // plain block box the root grows to its content and nothing scrolls.
      return div(
        {
          style:
            'display: grid; height: 10rem; width: 16rem; border: 1px solid var(--border); border-radius: 0.375rem',
        },
        [
          div({ ...parts.root, 'aria-label': 'Release notes' }, [
            div({ ...parts.viewport }, [
              div(
                { ...parts.content },
                lines.map((line) =>
                  div(
                    {
                      style: `padding: 0.25rem 0.75rem;${data.wide ? ' white-space: nowrap; width: 32rem' : ''}`,
                    },
                    [text(line)],
                  ),
                ),
              ),
            ]),
            div({ ...parts.scrollbarY }, [div({ ...parts.thumbY })]),
            div({ ...parts.scrollbarX }, [div({ ...parts.thumbX })]),
            div({ ...parts.corner }),
            measureScrollArea(send),
          ]),
        ],
      )
    },
  )

const signaturePadAdapter: Adapter<SignaturePadCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineSignaturePadScenario',
    () => signaturePadInit(data),
    signaturePad.update,
    (state, send) => {
      const parts = signaturePad.connect(state, send, { name: 'signature' })
      return div({ ...parts.root }, [
        div({ ...parts.control }, [
          // The consumer's share of a PARTIAL product: drawing the ink.
          svg(
            {
              width: '100%',
              height: '100%',
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
          div({ ...parts.guide }),
        ]),
        row([
          button({ ...parts.undoTrigger }, [text('Undo')]),
          button({ ...parts.clearTrigger }, [text('Clear')]),
        ]),
        input({ ...parts.hiddenInput }),
      ])
    },
  )

const sortableAdapter: Adapter<SortableCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineSortableScenario',
    () => sortableScenarioInit(data),
    sortableScenarioUpdate,
    (state, send) => {
      const parts = sortable.connect(state.at('sort'), send, { id: SORTABLE_CONTAINER })
      return div({ ...parts.root }, [
        each(state.at('items'), {
          key: (item) => item.id,
          render: (item, index) => {
            // Keyed by id: the id is the row's identity for its whole life.
            const id = item.peek().id
            const at = index.peek()
            return [
              div({ ...parts.item(id, at) }, [
                div({ ...parts.handle(id, at) }, [glyph('grip')]),
                span([text(item.at('label'))]),
              ]),
            ]
          },
        }),
      ])
    },
  )

const splitterAdapter: Adapter<SplitterCaseInput> = (host, data, ctx) => {
  // The consumer sizes the group; the splitter fills it.
  host.style.height = '8rem'
  return mountMachine(
    host,
    ctx,
    'BaselineSplitterScenario',
    () => splitterInit(data, ctx.environment.direction),
    splitter.update,
    (state, send) => {
      const parts = splitter.connect(state, send)
      return [
        splitterPointerWiring(state, send),
        div({ ...parts.root }, [
          div({ ...parts.primaryPanel }, [div({ style: 'padding: 0.75rem' }, [text('Outline')])]),
          div({ ...parts.resizeTrigger }),
          div({ ...parts.secondaryPanel }, [div({ style: 'padding: 0.75rem' }, [text('Editor')])]),
        ]),
      ]
    },
  )
}

const timePickerAdapter: Adapter<TimePickerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineTimePickerScenario',
    () => timePickerInit(data),
    timePicker.update,
    (state, send) => {
      const parts = timePicker.connect(state, send)
      return div({ ...parts.root }, [
        input({ ...parts.hoursInput }),
        span({ 'aria-hidden': 'true' }, [text(':')]),
        input({ ...parts.minutesInput }),
        button({ ...parts.periodTrigger }, [text(state.map((s) => timePicker.period(s)))]),
      ])
    },
  )

const timerAdapter: Adapter<TimerCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineTimerScenario',
    () => timerInit(data),
    timer.update,
    (state, send) => {
      const parts = timer.connect(state, send)
      return div({ ...parts.root }, [
        div({ ...parts.display }, [text(state.map((s) => mmss(timer.display(s))))]),
        button({ ...parts.startTrigger }, [text('Start')]),
        button({ ...parts.pauseTrigger }, [text('Pause')]),
        button({ ...parts.resetTrigger }, [text('Reset')]),
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
    'BaselineTourScenario',
    () => tourInit(data),
    tour.update,
    (state, send) => {
      const parts = tour.connect(state, send, { id: `baseline-tour-${ctx.caseId}` })
      const step = data.steps[data.index]!
      return [
        // The step target the tour points at — app content, not a tour part.
        div(
          {
            'data-tour-target': step.id,
            style: `position: absolute; ${px(TOUR_TARGET_BOX)}; border: 1px dashed currentColor; border-radius: 0.375rem; display: flex; align-items: center; justify-content: center`,
          },
          [text(step.title)],
        ),
        // The consumer positions both the spotlight and the card (PARTIAL).
        data.spotlight
          ? div({ ...parts.spotlight, style: px(TOUR_TARGET_BOX) })
          : div({ ...parts.backdrop }),
        div({ ...parts.root, style: `position: fixed; ${px(TOUR_CARD_POSITION)}` }, [
          div({ ...parts.title }, [text(step.title)]),
          p({ ...parts.description }, [text(step.description)]),
          p({ ...parts.progressText }, [text(`Step ${data.index + 1} of ${data.steps.length}`)]),
          row(
            [
              button({ ...parts.prevTrigger }, [text('Back')]),
              button({ ...parts.nextTrigger }, [
                text(state.map((s) => (s.index >= s.steps.length - 1 ? 'Done' : 'Next'))),
              ]),
            ],
            'justify-content: flex-end',
          ),
          button({ ...parts.closeTrigger }, [glyph('x')]),
        ]),
      ]
    },
  )
}

const wizardAdapter: Adapter<WizardCaseInput> = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineWizardScenario',
    () => wizardInit(data),
    (state: wizard.WizardState, msg: wizard.WizardMsg) => wizard.update(state, msg),
    (state, send) => {
      const parts = wizard.connect(state, send, { label: 'Sign-up' })
      return div({ style: 'display: flex; flex-direction: column; gap: 0.75rem' }, [
        div(
          { ...parts.root },
          data.steps.map((name, index) => {
            const item = parts.item(index)
            return div({ ...item.item }, [
              button({ ...item.trigger }, [text(String(index + 1))]),
              span([text(name)]),
              ...(index < data.steps.length - 1 ? [div({ ...item.separator })] : []),
            ])
          }),
        ),
        // The wizard's actions take the foundation `.btn` classes — every part
        // it publishes is steps-scoped, which is why it is PARTIAL here.
        row([
          button({ ...parts.prevTrigger, class: 'btn btn-secondary btn-sm' }, [text('Back')]),
          button({ ...parts.nextTrigger, class: 'btn btn-primary btn-sm' }, [
            text(state.map((s) => (s.validating !== null ? 'Checking…' : 'Next'))),
          ]),
        ]),
      ])
    },
  )

/** Adapters for every product whose baseline mode is visually applicable. */
export const BASELINE_ADAPTERS = {
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
} as const satisfies Partial<Record<SpecializedToolsScenarioId, Adapter<never>>>

function renderResolved(
  host: HTMLElement,
  scenarioId: string,
  caseId: string,
  data: unknown,
  environment: PresentationScenarioEnvironment,
): Disposable {
  const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
  if (adapter === undefined) {
    throw new Error(`No baseline adapter registered for specialized-tools scenario ${scenarioId}`)
  }
  return (adapter as Adapter<unknown>)(host, data, {
    scenarioId: scenarioId as SpecializedToolsScenarioId,
    caseId,
    environment,
  })
}

function assertBindings(scenarios: readonly SpecializedToolsJoinedScenario[]): void {
  const expected = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bound = Object.keys(BASELINE_ADAPTERS).sort()
  if (JSON.stringify(expected) !== JSON.stringify(bound)) {
    throw new Error(
      `Baseline specialized-tools bindings do not match applicable ProductContract scenarios: expected ${expected.join(', ')}; received ${bound.join(', ')}`,
    )
  }
}

export interface MountOptions {
  /** Environment overrides; each case applies only the axes it declares. */
  readonly environment?: Partial<PresentationScenarioEnvironment>
}

export function mountBaselineSpecializedToolsScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: SpecializedToolsCatalog,
  scenarios: readonly SpecializedToolsJoinedScenario[] = applicableSpecializedToolsScenarios(
    joinSpecializedToolsScenarios(catalog, contract),
    'baseline',
  ),
  options: MountOptions = {},
): Disposable {
  assertBindings(scenarios)
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
        path: 'baseline',
        environment,
      })
      const host = document.createElement('section')
      host.id = `baseline-${scenario.productId}--${scenarioCase.id}`
      host.dataset.scenarioRenderer = 'baseline'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(
        renderResolved(
          host,
          resolved.scenarioId,
          resolved.case.id,
          resolved.case.input,
          resolved.environment,
        ),
      )
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
    },
  }
}
