/**
 * The ONE specialized-tools family module (#266; #270 protocol; mirrors the
 * accepted #264 navigation-data and #265 menus-overlays shape).
 *
 * The specialized-tools family is DERIVED, not chosen: it is every canonical
 * ProductContract entry that the forms/controls (#263), navigation/data (#264)
 * and menus/overlays (#265) tickets do not own — pickers, editors, upload and
 * canvas tools, and the remaining utilities. `SPECIALIZED_TOOLS_PRODUCT_IDS`
 * is that residue spelled out, and `specialized-tools-contract.test.ts` pins it
 * against the contract by EXACT set equality in both directions, so an entry
 * can neither fall between the four families nor be claimed twice.
 *
 * Three things live here, all renderer-neutral protocol DATA:
 *
 *  - `SPECIALIZED_TOOLS_CLASSIFICATION` — per product and per styling path,
 *    whether that path owns the visuals (`styled`), deliberately owns only
 *    part of them (`partial`), composes other products (`composed`), owns
 *    nothing because the product is behaviour-only (`styleless`), or has no
 *    artifact on that path (`not-applicable`) — with the ownership boundary in
 *    words. The contract test requires the ProductContract to say the same.
 *  - `SPECIALIZED_TOOLS_DEFINITIONS` — every semantic case, keyed by
 *    `scenarioId`, whose `input` mirrors the product's REAL `init()` fields.
 *    Everything is deterministic: dates are pinned ISO strings (`today` is
 *    part of the input, never the clock), the time-zone case carries a fixed
 *    INSTANT, identifiers are literal, the QR matrix is a literal, images are
 *    described by size and drawn locally by the renderer, and nothing names a
 *    URL. `specialized-tools-contract.test.ts` enforces all of it.
 *  - Coverage tables the gallery (#267) and the browser tests read: the state
 *    matrix each complex product must expose, forced-colors cues, and the
 *    input-modality parity each interactive product claims.
 *
 * Renderer adapters live in `specialized-tools-baseline-renderer.ts` and
 * `registry/test/specialized-tools-scenario-renderer.ts` — separate maps over
 * this ONE catalog, per the protocol's own rule.
 */
import {
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioEnvironment,
  type PresentationScenarioEnvironmentAxis,
  type ResolvedPresentationScenarioSelection,
} from '@llui/cli/presentation-scenarios'
import type { ProductContract, ProductEntry } from '@llui/cli'
import { axes } from './scenario-field-mutations'

// Individual named arrays, never a `Record`-typed lookup (see
// navigation-data-scenarios.ts): an index signature widens every read to
// `T | undefined` under `noUncheckedIndexedAccess`.
const AX = {
  none: axes(),
  surface: axes('theme', 'forcedColors'),
  dirSurface: axes('theme', 'direction', 'forcedColors'),
  responsive: axes('theme', 'direction', 'viewport', 'forcedColors'),
  motion: axes('theme', 'motion', 'forcedColors'),
  all: axes('theme', 'direction', 'motion', 'viewport', 'forcedColors'),
  theme: axes('theme'),
  dir: axes('direction'),
}

// ─── Deterministic fixtures ───────────────────────────────────────────────

/** The one "today" every date scenario pins. Never read from a clock. */
export const FIXED_TODAY = '2026-03-14'
/** 2026-03-14T23:30:00Z — still the 14th in Los Angeles, the 15th in Auckland. */
export const FIXED_INSTANT = 1773531000000

/**
 * A real, scannable QR code for the text `llui.dev/r/qr-code` (ECC M, one
 * module of quiet border), encoded ONCE with `uqr` and frozen here as literal
 * rows so no scenario runs an encoder, a random mask choice, or anything that
 * could drift between runs.
 */
export const QR_FIXTURE_VALUE = 'llui.dev/r/qr-code'
export const QR_FIXTURE_ROWS: readonly string[] = [
  '000000000000000000000000000',
  '011111110101111111011111110',
  '010000010000111000010000010',
  '010111010011000110010111010',
  '010111010101010011010111010',
  '010111010100110111010111010',
  '010000010101000001010000010',
  '011111110101010101011111110',
  '000000000101111000000000000',
  '010001011110111010111110010',
  '001000101111001111100110100',
  '001110111101010010101101000',
  '011111100011000101111101100',
  '010011110010001100011001100',
  '011001100010010011001101000',
  '000101010000111110010101000',
  '000011101101101010011011100',
  '011100010101011011111101100',
  '000000000101001101000111000',
  '011111110101000001010110000',
  '010000010010010111000101110',
  '010111010110101101111101010',
  '010111010010010001110010110',
  '010111010001111111011011100',
  '010000010011101000101001100',
  '011111110101011010110101110',
  '000000000000000000000000000',
]

/** Decode the literal rows into the machine's `boolean[][]` matrix. */
export function qrFixtureMatrix(rows: readonly string[] = QR_FIXTURE_ROWS): boolean[][] {
  return rows.map((row) => [...row].map((bit) => bit === '1'))
}

/** A two-stroke signature, in control-local pixels. Literal, never sampled. */
export const SIGNATURE_FIXTURE_STROKES: readonly (readonly { x: number; y: number }[])[] = [
  [
    { x: 24, y: 88 },
    { x: 40, y: 60 },
    { x: 56, y: 92 },
    { x: 72, y: 58 },
    { x: 92, y: 90 },
  ],
  [
    { x: 110, y: 84 },
    { x: 140, y: 70 },
    { x: 176, y: 82 },
    { x: 210, y: 64 },
  ],
]

/** Accepted files for upload scenarios. Stable literal ids, never generated. */
export const FILE_FIXTURES = [
  { id: 'file-report', name: 'q1-report.pdf', size: 482_304, type: 'application/pdf' },
  { id: 'file-photo', name: 'team-photo.png', size: 1_310_720, type: 'image/png' },
  { id: 'file-notes', name: 'notes.txt', size: 2_048, type: 'text/plain' },
] as const

// ─── Case inputs (mirroring each machine's real init fields) ─────────────────

export type AsyncListStatus = 'idle' | 'loading' | 'loaded' | 'error'
export type AsyncListCaseInput = {
  readonly status: AsyncListStatus
  readonly items: readonly string[]
  readonly hasMore: boolean
  readonly error: string | null
}

export type CascadeLevelFixture = {
  readonly id: string
  readonly label: string
  readonly options: readonly { readonly value: string; readonly label: string }[]
}
export type CascadeSelectCaseInput = {
  readonly levels: readonly CascadeLevelFixture[]
  readonly values: readonly (string | null)[]
  readonly disabled: boolean
}

export type ClipboardCaseInput = {
  readonly value: string
  readonly outcome: 'idle' | 'copied' | 'failed'
}

export type ColorPickerCaseInput = {
  readonly model: 'hsv' | 'oklch'
  readonly color: string
  readonly disabled: boolean
  readonly swatches: readonly string[]
}

export type DateInputCaseInput = {
  readonly input: string
  readonly min: string | null
  readonly max: string | null
  readonly disabled: boolean
  readonly readonly: boolean
  readonly required: boolean
}

export type DatePickerCaseInput = {
  readonly mode: 'single' | 'range'
  readonly value: string | null
  readonly start: string | null
  readonly end: string | null
  readonly visibleYear: number
  readonly visibleMonth: number
  readonly months: number
  readonly min: string | null
  readonly max: string | null
  readonly unavailable: readonly string[]
  readonly weekStartsOn: 0 | 1
  readonly locale: string
  /** Pinned today; ignored when `timeZone` is set. */
  readonly today: string
  /** When set, `today` is `todayInTimeZone(timeZone, instant)`. */
  readonly timeZone: string | null
  readonly instant: number | null
  readonly density: 'comfortable' | 'compact'
}

export type EditableCaseInput = {
  readonly value: string
  readonly editing: boolean
  readonly disabled: boolean
  readonly placeholder: string
}

export type FileUploadCaseInput = {
  readonly fileIds: readonly string[]
  readonly dragging: boolean
  readonly disabled: boolean
  readonly invalid: boolean
  readonly rejected: readonly { readonly name: string; readonly code: 'INVALID_TYPE' }[]
  readonly uploads: readonly {
    readonly id: string
    readonly status: 'uploading' | 'done' | 'error'
    readonly progress: number
    readonly error: string | null
  }[]
}

export type FloatingPanelCaseInput = {
  readonly title: string
  readonly body: string
  readonly width: number
  readonly height: number
  readonly minimized: boolean
  readonly maximized: boolean
  readonly atMinimum: boolean
}

export type GradientPickerCaseInput = {
  readonly css: string
  readonly disabled: boolean
}

export type ImageCropperCaseInput = {
  readonly image: { readonly width: number; readonly height: number }
  readonly aspectRatio: number | null
  readonly crop: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
  readonly zoomSteps: number
  readonly disabled: boolean
  readonly dragging: boolean
}

export type InViewCaseInput = {
  readonly visible: boolean
}

export type PresenceCaseInput = {
  readonly status: 'opening' | 'open' | 'closing' | 'closed'
}

export type QrCodeCaseInput = {
  readonly value: string
  readonly rows: readonly string[]
}

export type ScrollAreaCaseInput = {
  readonly rows: number
  readonly wide: boolean
  readonly visibility: 'auto' | 'always' | 'hover' | 'scroll'
}

export type SignaturePadCaseInput = {
  readonly strokes: readonly (readonly { readonly x: number; readonly y: number }[])[]
  readonly clearedThenRestorable: boolean
  readonly disabled: boolean
  readonly readonly: boolean
}

export type SortableCaseInput = {
  readonly items: readonly string[]
  /** Drag the item at `from` over the item at `to` (pointer), or grab it (keyboard). */
  readonly drag: { readonly from: number; readonly to: number } | null
  readonly keyboardGrab: number | null
  /**
   * Whether the list renders the machine's `instructions` part (`connect`'s
   * `hasInstructions`). `false` is a consumer that supplies its own keyboard
   * help instead: no handle may then name the missing part.
   */
  readonly hasInstructions: boolean
}

export type SplitterCaseInput = {
  readonly orientation: 'horizontal' | 'vertical'
  readonly position: number
  readonly min: number
  readonly max: number
  readonly disabled: boolean
}

export type TimePickerCaseInput = {
  readonly hours: number
  readonly minutes: number
  readonly format: '12' | '24'
  readonly disabled: boolean
}

export type TimerCaseInput = {
  readonly direction: 'up' | 'down'
  readonly targetMs: number
  readonly elapsedMs: number
  readonly running: boolean
}

export type TourStepFixture = {
  readonly id: string
  readonly title: string
  readonly description: string
}
export type TourCaseInput = {
  readonly steps: readonly TourStepFixture[]
  readonly index: number
  readonly spotlight: boolean
}

export type WizardCaseInput = {
  readonly steps: readonly string[]
  readonly current: number
  readonly completed: readonly number[]
  readonly validating: boolean
}

export type AspectRatioCaseInput = {
  readonly ratio: number
  readonly label: string
}

export type IconsCaseInput = {
  readonly glyphs: readonly string[]
  readonly sizeClass: 'default' | 'large'
}

// ─── Shared fixture values ────────────────────────────────────────────────

const CASCADE_LEVELS: readonly CascadeLevelFixture[] = [
  {
    id: 'country',
    label: 'Country',
    options: [
      { value: 'IT', label: 'Italy' },
      { value: 'PT', label: 'Portugal' },
    ],
  },
  {
    id: 'region',
    label: 'Region',
    options: [
      { value: 'IT-25', label: 'Lombardy' },
      { value: 'IT-62', label: 'Lazio' },
    ],
  },
  {
    id: 'city',
    label: 'City',
    options: [
      { value: 'MI', label: 'Milan' },
      { value: 'BG', label: 'Bergamo' },
    ],
  },
]

const DATE_PICKER_BASE: DatePickerCaseInput = {
  mode: 'single',
  value: '2026-03-18',
  start: null,
  end: null,
  visibleYear: 2026,
  visibleMonth: 3,
  months: 1,
  min: null,
  max: null,
  unavailable: [],
  weekStartsOn: 0,
  locale: 'en-US',
  today: FIXED_TODAY,
  timeZone: null,
  instant: null,
  density: 'comfortable',
}

const FILE_UPLOAD_BASE: FileUploadCaseInput = {
  fileIds: [],
  dragging: false,
  disabled: false,
  invalid: false,
  rejected: [],
  uploads: [],
}

const TOUR_STEPS: readonly TourStepFixture[] = [
  { id: 'welcome', title: 'Welcome', description: 'A short tour of the editor.' },
  { id: 'toolbar', title: 'Formatting', description: 'Bold, lists and links live here.' },
  { id: 'publish', title: 'Publish', description: 'Share when you are ready.' },
]

const SORTABLE_ITEMS: readonly string[] = ['Design review', 'Write tests', 'Ship release']

// ─── Definitions ───────────────────────────────────────────────────────────

export const SPECIALIZED_TOOLS_DEFINITIONS = {
  'component:async-list': {
    defaultCaseId: 'loaded',
    cases: [
      {
        id: 'loaded',
        label: 'Loaded, more available',
        input: {
          status: 'loaded',
          items: ['Invoice 1041', 'Invoice 1042', 'Invoice 1043'],
          hasMore: true,
          error: null,
        } satisfies AsyncListCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'loading',
        label: 'Loading next page',
        input: {
          status: 'loading',
          items: ['Invoice 1041', 'Invoice 1042', 'Invoice 1043'],
          hasMore: true,
          error: null,
        } satisfies AsyncListCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'error',
        label: 'Load failed, retry offered',
        input: {
          status: 'error',
          items: ['Invoice 1041'],
          hasMore: true,
          error: 'The server did not respond. Try again.',
        } satisfies AsyncListCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'empty',
        label: 'Empty result',
        input: {
          status: 'loaded',
          items: [],
          hasMore: false,
          error: null,
        } satisfies AsyncListCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'exhausted',
        label: 'Every page loaded',
        input: {
          status: 'loaded',
          items: ['Invoice 1041', 'Invoice 1042'],
          hasMore: false,
          error: null,
        } satisfies AsyncListCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:cascade-select': {
    defaultCaseId: 'partial',
    cases: [
      {
        id: 'partial',
        label: 'First level chosen',
        input: {
          levels: CASCADE_LEVELS,
          values: ['IT', null, null],
          disabled: false,
        } satisfies CascadeSelectCaseInput,
        environmentAxes: AX.responsive,
      },
      {
        id: 'complete',
        label: 'Every level chosen',
        input: {
          levels: CASCADE_LEVELS,
          values: ['IT', 'IT-25', 'MI'],
          disabled: false,
        } satisfies CascadeSelectCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'empty',
        label: 'Nothing chosen',
        input: {
          levels: CASCADE_LEVELS,
          values: [null, null, null],
          disabled: false,
        } satisfies CascadeSelectCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          levels: CASCADE_LEVELS,
          values: ['IT', 'IT-25', null],
          disabled: true,
        } satisfies CascadeSelectCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:clipboard': {
    defaultCaseId: 'idle',
    cases: [
      {
        id: 'idle',
        label: 'Ready to copy',
        input: { value: 'pnpm add @llui/components', outcome: 'idle' } satisfies ClipboardCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'copied',
        label: 'Copied',
        input: {
          value: 'pnpm add @llui/components',
          outcome: 'copied',
        } satisfies ClipboardCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'permission-denied',
        label: 'Clipboard permission refused',
        input: {
          value: 'pnpm add @llui/components',
          outcome: 'failed',
        } satisfies ClipboardCaseInput,
        environmentAxes: AX.dirSurface,
      },
    ],
  },
  'component:color-picker': {
    defaultCaseId: 'oklch',
    cases: [
      {
        id: 'oklch',
        label: 'OKLCH model',
        input: {
          model: 'oklch',
          color: 'oklch(0.7 0.15 250)',
          disabled: false,
          swatches: ['#ef4444', '#eab308', '#22c55e', '#3b82f6'],
        } satisfies ColorPickerCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'hsv-alpha',
        label: 'HSV with transparency',
        input: {
          model: 'hsv',
          color: 'rgb(34 197 94 / 60%)',
          disabled: false,
          swatches: ['#ef4444', '#eab308', '#22c55e', '#3b82f6'],
        } satisfies ColorPickerCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          model: 'hsv',
          color: '#3b82f6',
          disabled: true,
          swatches: ['#ef4444', '#3b82f6'],
        } satisfies ColorPickerCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:date-input': {
    defaultCaseId: 'empty',
    cases: [
      {
        id: 'empty',
        label: 'Empty, required',
        input: {
          input: '',
          min: null,
          max: null,
          disabled: false,
          readonly: false,
          required: true,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.responsive,
      },
      {
        id: 'valid',
        label: 'Valid date',
        input: {
          input: '2026-03-14',
          min: null,
          max: null,
          disabled: false,
          readonly: false,
          required: true,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'invalid',
        label: 'Unparseable text',
        input: {
          input: '2026-13-40',
          min: null,
          max: null,
          disabled: false,
          readonly: false,
          required: true,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'out-of-range',
        label: 'Outside the allowed range',
        input: {
          input: '2026-05-02',
          min: '2026-03-01',
          max: '2026-03-31',
          disabled: false,
          readonly: false,
          required: false,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          input: '2026-03-14',
          min: null,
          max: null,
          disabled: true,
          readonly: false,
          required: false,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'read-only',
        label: 'Read-only',
        input: {
          input: '2026-03-14',
          min: null,
          max: null,
          disabled: false,
          readonly: true,
          required: false,
        } satisfies DateInputCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:date-picker': {
    defaultCaseId: 'single',
    cases: [
      {
        id: 'single',
        label: 'Single date, today marked',
        input: DATE_PICKER_BASE,
        environmentAxes: AX.all,
      },
      {
        id: 'range',
        label: 'Date range',
        input: {
          ...DATE_PICKER_BASE,
          mode: 'range',
          value: null,
          start: '2026-03-09',
          end: '2026-03-13',
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'unavailable',
        label: 'Unavailable dates and bounds',
        input: {
          ...DATE_PICKER_BASE,
          value: null,
          min: '2026-03-05',
          max: '2026-03-27',
          unavailable: ['2026-03-18', '2026-03-19', '2026-03-20'],
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'locale-de',
        label: 'German locale, week starts Monday',
        input: {
          ...DATE_PICKER_BASE,
          locale: 'de-DE',
          weekStartsOn: 1,
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'locale-ar-rtl',
        label: 'Arabic locale, right to left',
        input: {
          ...DATE_PICKER_BASE,
          locale: 'ar-EG',
          weekStartsOn: 0,
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.dir,
      },
      {
        id: 'time-zone',
        label: 'Today in Pacific/Auckland',
        input: {
          ...DATE_PICKER_BASE,
          value: null,
          timeZone: 'Pacific/Auckland',
          instant: FIXED_INSTANT,
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'compact',
        label: 'Compact density',
        input: { ...DATE_PICKER_BASE, density: 'compact' } satisfies DatePickerCaseInput,
        environmentAxes: AX.theme,
      },
      {
        id: 'two-months',
        label: 'Two months side by side',
        input: {
          ...DATE_PICKER_BASE,
          mode: 'range',
          value: null,
          start: '2026-03-28',
          end: '2026-04-03',
          months: 2,
        } satisfies DatePickerCaseInput,
        environmentAxes: AX.responsive,
        copiedArtifactNames: ['calendar'],
      },
    ],
  },
  'component:editable': {
    defaultCaseId: 'preview',
    cases: [
      {
        id: 'preview',
        label: 'Preview',
        input: {
          value: 'Quarterly plan',
          editing: false,
          disabled: false,
          placeholder: 'Untitled',
        } satisfies EditableCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'editing',
        label: 'Editing',
        input: {
          value: 'Quarterly plan',
          editing: true,
          disabled: false,
          placeholder: 'Untitled',
        } satisfies EditableCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'empty',
        label: 'Empty value shows the placeholder',
        input: {
          value: '',
          editing: false,
          disabled: false,
          placeholder: 'Untitled',
        } satisfies EditableCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          value: 'Quarterly plan',
          editing: false,
          disabled: true,
          placeholder: 'Untitled',
        } satisfies EditableCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:file-upload': {
    defaultCaseId: 'empty',
    cases: [
      {
        id: 'empty',
        label: 'Empty drop zone',
        input: FILE_UPLOAD_BASE,
        environmentAxes: AX.responsive,
      },
      {
        id: 'dragging',
        label: 'File dragged over',
        input: { ...FILE_UPLOAD_BASE, dragging: true } satisfies FileUploadCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'uploading',
        label: 'Uploading with progress',
        input: {
          ...FILE_UPLOAD_BASE,
          fileIds: ['file-report', 'file-photo'],
          uploads: [
            { id: 'file-report', status: 'done', progress: 1, error: null },
            { id: 'file-photo', status: 'uploading', progress: 0.42, error: null },
          ],
        } satisfies FileUploadCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'error-retry',
        label: 'Upload failed, retry offered',
        input: {
          ...FILE_UPLOAD_BASE,
          fileIds: ['file-report', 'file-notes'],
          uploads: [
            { id: 'file-report', status: 'error', progress: 0.6, error: 'Connection lost at 60%.' },
          ],
        } satisfies FileUploadCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'rejected',
        label: 'Rejected file',
        input: {
          ...FILE_UPLOAD_BASE,
          invalid: true,
          rejected: [{ name: 'archive.zip', code: 'INVALID_TYPE' }],
        } satisfies FileUploadCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: { ...FILE_UPLOAD_BASE, disabled: true } satisfies FileUploadCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:floating-panel': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open',
        input: {
          title: 'Layers',
          body: 'Background, Title, Chart',
          width: 280,
          height: 180,
          minimized: false,
          maximized: false,
          atMinimum: false,
        } satisfies FloatingPanelCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'minimized',
        label: 'Minimized to its handle',
        input: {
          title: 'Layers',
          body: 'Background, Title, Chart',
          width: 280,
          height: 180,
          minimized: true,
          maximized: false,
          atMinimum: false,
        } satisfies FloatingPanelCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'maximized',
        label: 'Maximized',
        input: {
          title: 'Layers',
          body: 'Background, Title, Chart',
          width: 280,
          height: 180,
          minimized: false,
          maximized: true,
          atMinimum: false,
        } satisfies FloatingPanelCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'min-size',
        label: 'Resized down to its minimum',
        input: {
          title: 'Layers',
          body: 'Background, Title, Chart',
          width: 280,
          height: 180,
          minimized: false,
          maximized: false,
          atMinimum: true,
        } satisfies FloatingPanelCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:gradient-picker': {
    defaultCaseId: 'linear',
    cases: [
      {
        id: 'linear',
        label: 'Linear gradient',
        input: {
          css: 'linear-gradient(90deg in oklch, oklch(0.7 0.2 25) 0%, oklch(0.7 0.2 260) 100%)',
          disabled: false,
        } satisfies GradientPickerCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'radial',
        label: 'Radial gradient, three stops',
        input: {
          css: 'radial-gradient(circle, #f97316 0%, #ec4899 50%, #8b5cf6 100%)',
          disabled: false,
        } satisfies GradientPickerCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          css: 'linear-gradient(90deg, #22c55e 0%, #3b82f6 100%)',
          disabled: true,
        } satisfies GradientPickerCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:image-cropper': {
    defaultCaseId: 'free',
    cases: [
      {
        id: 'free',
        label: 'Free-form crop',
        input: {
          image: { width: 400, height: 300 },
          aspectRatio: null,
          crop: { x: 60, y: 45, width: 240, height: 180 },
          zoomSteps: 0,
          disabled: false,
          dragging: false,
        } satisfies ImageCropperCaseInput,
        environmentAxes: AX.all,
      },
      {
        id: 'square',
        label: 'Locked 1:1',
        input: {
          image: { width: 400, height: 300 },
          aspectRatio: 1,
          crop: null,
          zoomSteps: 0,
          disabled: false,
          dragging: false,
        } satisfies ImageCropperCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'zoomed',
        label: 'Zoomed in twice',
        input: {
          image: { width: 400, height: 300 },
          aspectRatio: 1,
          crop: null,
          zoomSteps: 2,
          disabled: false,
          dragging: false,
        } satisfies ImageCropperCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'dragging',
        label: 'Dragging',
        input: {
          image: { width: 400, height: 300 },
          aspectRatio: null,
          crop: { x: 60, y: 45, width: 240, height: 180 },
          zoomSteps: 0,
          disabled: false,
          dragging: true,
        } satisfies ImageCropperCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          image: { width: 400, height: 300 },
          aspectRatio: null,
          crop: { x: 60, y: 45, width: 240, height: 180 },
          zoomSteps: 0,
          disabled: true,
          dragging: false,
        } satisfies ImageCropperCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:in-view': {
    defaultCaseId: 'hidden',
    cases: [
      {
        id: 'hidden',
        label: 'Not yet in view',
        input: { visible: false } satisfies InViewCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'visible',
        label: 'In view',
        input: { visible: true } satisfies InViewCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:presence': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open',
        input: { status: 'open' } satisfies PresenceCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: { status: 'opening' } satisfies PresenceCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { status: 'closing' } satisfies PresenceCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'closed',
        label: 'Closed',
        input: { status: 'closed' } satisfies PresenceCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:qr-code': {
    defaultCaseId: 'code',
    cases: [
      {
        id: 'code',
        label: 'Encoded value',
        input: { value: QR_FIXTURE_VALUE, rows: QR_FIXTURE_ROWS } satisfies QrCodeCaseInput,
        environmentAxes: AX.all,
      },
      {
        id: 'empty',
        label: 'Nothing encoded yet',
        input: { value: '', rows: [] } satisfies QrCodeCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:scroll-area': {
    defaultCaseId: 'vertical',
    cases: [
      {
        id: 'vertical',
        label: 'Vertical overflow',
        input: { rows: 24, wide: false, visibility: 'always' } satisfies ScrollAreaCaseInput,
        environmentAxes: AX.all,
      },
      {
        id: 'both-axes',
        label: 'Overflow on both axes',
        input: { rows: 24, wide: true, visibility: 'always' } satisfies ScrollAreaCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'fits',
        label: 'Content fits, no scrollbar',
        input: { rows: 2, wide: false, visibility: 'always' } satisfies ScrollAreaCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:signature-pad': {
    defaultCaseId: 'empty',
    cases: [
      {
        id: 'empty',
        label: 'Empty, sign here',
        input: {
          strokes: [],
          clearedThenRestorable: false,
          disabled: false,
          readonly: false,
        } satisfies SignaturePadCaseInput,
        environmentAxes: AX.responsive,
      },
      {
        id: 'signed',
        label: 'Signed',
        input: {
          strokes: SIGNATURE_FIXTURE_STROKES,
          clearedThenRestorable: false,
          disabled: false,
          readonly: false,
        } satisfies SignaturePadCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'cleared-undoable',
        label: 'Cleared, undo restores it',
        input: {
          strokes: SIGNATURE_FIXTURE_STROKES,
          clearedThenRestorable: true,
          disabled: false,
          readonly: false,
        } satisfies SignaturePadCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'read-only',
        label: 'Read-only',
        input: {
          strokes: SIGNATURE_FIXTURE_STROKES,
          clearedThenRestorable: false,
          disabled: false,
          readonly: true,
        } satisfies SignaturePadCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          strokes: [],
          clearedThenRestorable: false,
          disabled: true,
          readonly: false,
        } satisfies SignaturePadCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:sortable': {
    defaultCaseId: 'idle',
    cases: [
      {
        id: 'idle',
        label: 'Idle list',
        input: {
          items: SORTABLE_ITEMS,
          drag: null,
          keyboardGrab: null,
          hasInstructions: true,
        } satisfies SortableCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'dragging',
        label: 'Dragging over a drop target',
        input: {
          items: SORTABLE_ITEMS,
          drag: { from: 0, to: 2 },
          keyboardGrab: null,
          hasInstructions: true,
        } satisfies SortableCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'keyboard-grab',
        label: 'Grabbed with the keyboard',
        input: {
          items: SORTABLE_ITEMS,
          drag: null,
          keyboardGrab: 1,
          hasInstructions: true,
        } satisfies SortableCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'own-instructions',
        label: 'Consumer-owned keyboard help',
        input: {
          items: SORTABLE_ITEMS,
          drag: null,
          keyboardGrab: null,
          hasInstructions: false,
        } satisfies SortableCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:splitter': {
    defaultCaseId: 'horizontal',
    cases: [
      {
        id: 'horizontal',
        label: 'Side by side',
        input: {
          orientation: 'horizontal',
          position: 40,
          min: 20,
          max: 80,
          disabled: false,
        } satisfies SplitterCaseInput,
        environmentAxes: AX.all,
      },
      {
        id: 'vertical',
        label: 'Stacked',
        input: {
          orientation: 'vertical',
          position: 60,
          min: 20,
          max: 80,
          disabled: false,
        } satisfies SplitterCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'at-minimum',
        label: 'Constrained at its minimum',
        input: {
          orientation: 'horizontal',
          position: 20,
          min: 20,
          max: 80,
          disabled: false,
        } satisfies SplitterCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          orientation: 'horizontal',
          position: 50,
          min: 0,
          max: 100,
          disabled: true,
        } satisfies SplitterCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:time-picker': {
    defaultCaseId: 'twelve-hour',
    cases: [
      {
        id: 'twelve-hour',
        label: '12-hour clock',
        input: {
          hours: 14,
          minutes: 5,
          format: '12',
          disabled: false,
        } satisfies TimePickerCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'twenty-four-hour',
        label: '24-hour clock',
        input: {
          hours: 14,
          minutes: 5,
          format: '24',
          disabled: false,
        } satisfies TimePickerCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'disabled',
        label: 'Disabled',
        input: {
          hours: 9,
          minutes: 30,
          format: '24',
          disabled: true,
        } satisfies TimePickerCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:timer': {
    defaultCaseId: 'paused',
    cases: [
      {
        id: 'paused',
        label: 'Paused stopwatch',
        input: {
          direction: 'up',
          targetMs: 0,
          elapsedMs: 83_000,
          running: false,
        } satisfies TimerCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'running',
        label: 'Running countdown',
        input: {
          direction: 'down',
          targetMs: 300_000,
          elapsedMs: 45_000,
          running: true,
        } satisfies TimerCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'complete',
        label: 'Countdown finished',
        input: {
          direction: 'down',
          targetMs: 300_000,
          elapsedMs: 300_000,
          running: false,
        } satisfies TimerCaseInput,
        environmentAxes: AX.surface,
      },
    ],
  },
  'component:tour': {
    defaultCaseId: 'first-step',
    cases: [
      {
        id: 'first-step',
        label: 'First step',
        input: { steps: TOUR_STEPS, index: 0, spotlight: true } satisfies TourCaseInput,
        environmentAxes: AX.all,
      },
      {
        id: 'last-step',
        label: 'Last step',
        input: { steps: TOUR_STEPS, index: 2, spotlight: true } satisfies TourCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'no-spotlight',
        label: 'Step without a spotlight',
        input: { steps: TOUR_STEPS, index: 1, spotlight: false } satisfies TourCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'pattern:wizard': {
    defaultCaseId: 'second-step',
    cases: [
      {
        id: 'second-step',
        label: 'Second of three steps',
        input: {
          steps: ['Account', 'Profile', 'Review'],
          current: 1,
          completed: [0],
          validating: false,
        } satisfies WizardCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'validating',
        label: 'Validating before advancing',
        input: {
          steps: ['Account', 'Profile', 'Review'],
          current: 1,
          completed: [0],
          validating: true,
        } satisfies WizardCaseInput,
        environmentAxes: AX.motion,
      },
    ],
  },
  'registry:aspect-ratio': {
    defaultCaseId: 'widescreen',
    cases: [
      {
        id: 'widescreen',
        label: '16:9',
        input: { ratio: 16 / 9, label: '16:9 frame' } satisfies AspectRatioCaseInput,
        environmentAxes: AX.responsive,
      },
      {
        id: 'square',
        label: '1:1',
        input: { ratio: 1, label: '1:1 frame' } satisfies AspectRatioCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:icons': {
    defaultCaseId: 'set',
    cases: [
      {
        id: 'set',
        label: 'Inline glyph set',
        input: {
          glyphs: ['Check', 'ChevronDown', 'X', 'Calendar', 'Search'],
          sizeClass: 'default',
        } satisfies IconsCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'large',
        label: 'Caller-sized glyphs',
        input: {
          glyphs: ['Check', 'ChevronDown', 'X', 'Calendar', 'Search'],
          sizeClass: 'large',
        } satisfies IconsCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
} as const

export type SpecializedToolsDefinitions = typeof SPECIALIZED_TOOLS_DEFINITIONS
export type SpecializedToolsCatalog =
  CompiledPresentationScenarioFamily<SpecializedToolsDefinitions>
export type SpecializedToolsCompiledScenario = SpecializedToolsCatalog['scenarios'][number]
export type SpecializedToolsCompiledCase = SpecializedToolsCompiledScenario['cases'][number]
export type SpecializedToolsResolved =
  ResolvedPresentationScenarioSelection<SpecializedToolsDefinitions>
export type SpecializedToolsScenarioId = keyof SpecializedToolsDefinitions & string
export type SpecializedToolsPath = 'baseline' | 'registryTailwind'

export { resolveScenarioSelection }
export type { PresentationScenarioEnvironment }

export function compileSpecializedToolsCatalog(contract: ProductContract): SpecializedToolsCatalog {
  return compileScenarioFamily(contract, 'specialized-tools', SPECIALIZED_TOOLS_DEFINITIONS)
}

// ─── The family and its classification ─────────────────────────────────────

/**
 * Every canonical entry NOT owned by #263 (forms-controls), #264
 * (navigation-data) or #265 (menus-overlays). Pinned against the contract by
 * exact set equality — see the module header.
 */
export const SPECIALIZED_TOOLS_PRODUCT_IDS = [
  'aspect-ratio',
  'async-list',
  'cascade-select',
  'clipboard',
  'color-picker',
  'date-input',
  'date-picker',
  'editable',
  'file-upload',
  'floating-panel',
  'gradient-picker',
  'icons',
  'image-cropper',
  'in-view',
  'presence',
  'qr-code',
  'scroll-area',
  'signature-pad',
  'sortable',
  'splitter',
  'time-picker',
  'timer',
  'tour',
  'wizard',
] as const

export type SpecializedToolsProductId = (typeof SPECIALIZED_TOOLS_PRODUCT_IDS)[number]

/** The families whose tickets precede this one; the residue is ours. */
export const EARLIER_FAMILIES = ['forms-controls', 'navigation-data', 'menus-overlays'] as const

export type CoverageMode = 'styled' | 'partial' | 'composed' | 'styleless' | 'not-applicable'

export interface PathClassification {
  readonly mode: CoverageMode
  /** What this path owns, in words — required for every non-`styled` mode. */
  readonly owns: string
}

export interface ProductClassification {
  readonly baseline: PathClassification
  readonly registryTailwind: PathClassification
}

const STYLED = (owns: string): PathClassification => ({ mode: 'styled', owns })

/**
 * The per-product, per-path ownership statement. `specialized-tools-contract
 * .test.ts` requires the ProductContract's modes to equal these, requires a
 * baseline selector surface exactly for the `styled`/`partial` baseline rows,
 * a copied registry artifact exactly for the visually available registry
 * rows, and a tested composition example for every `styleless` row.
 */
export const SPECIALIZED_TOOLS_CLASSIFICATION: Readonly<
  Record<SpecializedToolsProductId, ProductClassification>
> = {
  'async-list': {
    baseline: STYLED('list stack, loading/error/empty/exhausted hierarchy, load-more and retry'),
    registryTailwind: STYLED('the same parts as outline/sm buttons and destructive error text'),
  },
  'cascade-select': {
    baseline: STYLED('level labels, native selects with focus/disabled/not-ready states, clear'),
    registryTailwind: STYLED('shadcn input vocabulary on native selects'),
  },
  clipboard: {
    baseline: STYLED('read-only field, inset trigger, copied and permission-failure states'),
    registryTailwind: STYLED('input recipe with an inset trigger'),
  },
  'color-picker': {
    baseline: STYLED('area, thumbs, sliders, swatches, hex input, preview (#264)'),
    registryTailwind: STYLED('the #264 skin'),
  },
  'date-input': {
    baseline: STYLED('field, inset clear trigger, invalid/disabled/read-only, error text'),
    registryTailwind: STYLED('input recipe with an inset clear trigger'),
  },
  'date-picker': {
    baseline: STYLED(
      'calendar grid, today/selected/range/unavailable/disabled/focused cells, navigation',
    ),
    registryTailwind: STYLED('shadcn Calendar recipe plus the docs date-picker trigger'),
  },
  editable: {
    baseline: STYLED('preview that matches the input box, input, submit/cancel/edit triggers'),
    registryTailwind: STYLED('input recipe and ghost/default buttons'),
  },
  'file-upload': {
    baseline: STYLED('dropzone with drag/invalid/disabled, file rows, progress, error, retry'),
    registryTailwind: STYLED('dashed dropzone, file rows, progress, error and retry'),
  },
  'floating-panel': {
    baseline: STYLED('raised surface, drag handle, window triggers, resize grip, min/max states'),
    registryTailwind: STYLED('the Dialog surface vocabulary'),
  },
  'gradient-picker': {
    baseline: STYLED('preview, stop track, stops, kind toggles and embedded picker (#264)'),
    registryTailwind: STYLED('the #264 skin'),
  },
  'image-cropper': {
    baseline: STYLED('frame, dimmed complement, crop box, corner grips, focus and disabled'),
    registryTailwind: STYLED('the same frame, dim, box and grips in Tailwind'),
  },
  'in-view': {
    baseline: {
      mode: 'styleless',
      owns: 'nothing visual: a behaviour-only visibility tracker whose data-state is consumed by the product it gates (composition example: in-view lazily mounts a styled qr-code)',
    },
    registryTailwind: {
      mode: 'styleless',
      owns: 'nothing: no copied artifact — the same behaviour composes under any skin',
    },
  },
  presence: {
    baseline: {
      mode: 'styleless',
      owns: 'nothing visual: a behaviour-only mount/exit lifecycle whose data-state drives the motion of the product it wraps (composition example: presence retains a styled clipboard confirmation through its exit)',
    },
    registryTailwind: {
      mode: 'styleless',
      owns: 'nothing: no copied artifact — the same lifecycle composes under any skin',
    },
  },
  'qr-code': {
    baseline: STYLED('framed code on a fixed light plate, modules, empty state, download'),
    registryTailwind: STYLED('the same plate and fixed module ink in Tailwind'),
  },
  'scroll-area': {
    baseline: STYLED('viewport focus ring, both scrollbars, thumbs and corner'),
    registryTailwind: STYLED('shadcn ScrollArea verbatim'),
  },
  'signature-pad': {
    baseline: {
      mode: 'partial',
      owns: 'directly owns the pad frame, baseline guide, empty placeholder, drawing/disabled/read-only states and triggers; the consumer draws the ink (canvas or SVG) from the stroke points',
    },
    registryTailwind: {
      mode: 'partial',
      owns: 'directly owns the same frame, guide and triggers; the consumer draws the ink from the stroke points',
    },
  },
  sortable: {
    baseline: STYLED('item cards, handle, dragging/over/shift/grabbed states'),
    registryTailwind: STYLED('the same item states in Tailwind'),
  },
  splitter: {
    baseline: STYLED('panels, separator with hover/focus/drag/disabled in both orientations'),
    registryTailwind: STYLED('shadcn Resizable (the `resizable` artifact)'),
  },
  'time-picker': {
    baseline: STYLED('segmented field with group focus ring, period toggle, disabled'),
    registryTailwind: STYLED('input-group vocabulary'),
  },
  timer: {
    baseline: STYLED('tabular display, start/pause/reset, running and complete states'),
    registryTailwind: STYLED('tabular display and default/outline/ghost buttons'),
  },
  tour: {
    baseline: {
      mode: 'partial',
      owns: 'directly owns the step card, backdrop, spotlight ring, progress and navigation chrome; the consumer positions the card and spotlight against each step target (attachFloating)',
    },
    registryTailwind: {
      mode: 'partial',
      owns: 'directly owns the popover-style card, backdrop and spotlight; the consumer positions them against each step target',
    },
  },
  wizard: {
    baseline: {
      mode: 'partial',
      owns: 'directly owns the steps-scoped indicator; its triggers take the foundation .btn classes; step content, validation and layout are consumer-owned',
    },
    registryTailwind: {
      mode: 'composed',
      owns: 'composes the steps indicator and button actions; the pattern copies no chrome',
    },
  },
  'aspect-ratio': {
    baseline: {
      mode: 'not-applicable',
      owns: 'no baseline package artifact: aspect-ratio is a copied-only layout helper',
    },
    registryTailwind: STYLED('the ratio box'),
  },
  icons: {
    baseline: {
      mode: 'not-applicable',
      owns: 'no baseline package artifact: icons are a copied-only glyph helper',
    },
    registryTailwind: {
      mode: 'partial',
      owns: 'directly owns safe glyph geometry and loading; each consuming recipe or caller owns semantic size and color',
    },
  },
}

/**
 * The complex state matrix each product must expose as named cases. The
 * contract test requires every listed case id; the gallery reads the same.
 */
export const REQUIRED_STATE_CASES: Readonly<
  Partial<Record<SpecializedToolsProductId, readonly string[]>>
> = {
  'async-list': ['loading', 'error', 'empty', 'exhausted'],
  'cascade-select': ['empty', 'complete', 'disabled'],
  clipboard: ['copied', 'permission-denied'],
  'date-input': ['invalid', 'out-of-range', 'disabled', 'read-only'],
  'date-picker': ['range', 'unavailable', 'locale-de', 'locale-ar-rtl', 'time-zone', 'compact'],
  editable: ['editing', 'empty', 'disabled'],
  'file-upload': ['empty', 'dragging', 'uploading', 'error-retry', 'rejected', 'disabled'],
  'floating-panel': ['minimized', 'maximized', 'min-size'],
  'image-cropper': ['square', 'zoomed', 'dragging', 'disabled'],
  'qr-code': ['empty'],
  'scroll-area': ['both-axes', 'fits'],
  'signature-pad': ['empty', 'signed', 'cleared-undoable', 'read-only', 'disabled'],
  sortable: ['dragging', 'keyboard-grab'],
  splitter: ['vertical', 'at-minimum', 'disabled'],
  timer: ['running', 'complete'],
  tour: ['first-step', 'last-step'],
  wizard: ['validating'],
}

/** Products whose chrome has a start/end edge: every one needs an RTL-capable case. */
export const DIRECTIONAL_PRODUCT_IDS: readonly SpecializedToolsProductId[] = [
  'async-list',
  'cascade-select',
  'clipboard',
  'color-picker',
  'date-input',
  'date-picker',
  'editable',
  'file-upload',
  'floating-panel',
  'gradient-picker',
  'image-cropper',
  'qr-code',
  'scroll-area',
  'signature-pad',
  'sortable',
  'splitter',
  'time-picker',
  'timer',
  'tour',
  'wizard',
  'aspect-ratio',
]

/** Products with motion a reduced-motion preference must quiet. */
export const MOTION_PRODUCT_IDS: readonly SpecializedToolsProductId[] = [
  'async-list',
  'date-picker',
  'file-upload',
  'image-cropper',
  'qr-code',
  'scroll-area',
  'sortable',
  'splitter',
  'tour',
  'wizard',
]

/** The non-colour cue each forced-colors-capable product relies on. */
export const FORCED_COLOR_CUES: Readonly<Partial<Record<SpecializedToolsProductId, string>>> = {
  'async-list': 'error text is a system-color alert region; triggers keep ButtonText borders',
  'cascade-select': 'native select borders stay ButtonText; disabled uses GrayText',
  clipboard: 'failure text is announced and outlined; the trigger keeps its ButtonText frame',
  'color-picker': 'thumbs keep a CanvasText ring over any painted area',
  'date-input': 'invalid border maps to Mark; error text stays visible',
  'date-picker': 'selected and range cells use Highlight; today keeps an outline',
  editable: 'the input keeps a ButtonText border; the preview keeps a focus outline',
  'file-upload': 'the dropzone keeps a dashed ButtonText border; progress uses Highlight',
  'floating-panel': 'the surface keeps a CanvasText border',
  'gradient-picker': 'stops keep a CanvasText ring over the ramp',
  'image-cropper': 'the crop box keeps a Highlight outline instead of the colour dim',
  'qr-code': 'forced-color-adjust: none keeps the plate light and modules dark',
  'scroll-area': 'the thumb paints CanvasText',
  'signature-pad': 'the pad keeps a ButtonText border and the guide stays dashed',
  sortable: 'the drop target keeps a Highlight border',
  splitter: 'the separator paints CanvasText and Highlight when focused',
  'time-picker': 'the group keeps a ButtonText border',
  timer: 'the complete state adds a Mark outline',
  tour: 'the card keeps a CanvasText border; the spotlight keeps a Highlight ring',
  wizard: 'step states keep the steps family forced-colors cues',
  'aspect-ratio': 'the frame keeps its border',
  icons: 'glyphs use currentColor and follow the forced text colour',
}

/**
 * Input-modality parity each interactive product claims. The browser tests
 * exercise the keyboard claims that #266 added; the rest are pinned by the
 * machine unit tests named in each row.
 */
export const INPUT_MODALITY_PARITY: Readonly<
  Partial<
    Record<
      SpecializedToolsProductId,
      { readonly keyboard: string; readonly pointerTouch: string; readonly assistiveTech: string }
    >
  >
> = {
  'date-picker': {
    keyboard: 'arrows, Home/End, PageUp/PageDown (moves the roving focus), Enter/Space',
    pointerTouch: 'click/tap a day; range hover preview on pointer devices',
    assistiveTech: 'role=grid with a localized label; unavailable days are aria-disabled',
  },
  'image-cropper': {
    keyboard: 'focusable crop box: arrows move 1% (Shift 10%), +/- zoom',
    pointerTouch: 'drag the box, drag a corner grip; touch-action none',
    assistiveTech: 'named group announcing live crop geometry',
  },
  'floating-panel': {
    keyboard: 'drag handle arrows move 10px (Shift 50px); each grip resizes with arrows',
    pointerTouch: 'drag the handle, drag a grip; touch-action none',
    assistiveTech: 'role=dialog; toggles publish aria-pressed',
  },
  sortable: {
    keyboard: 'Space/Enter grabs, arrows move, Escape cancels',
    pointerTouch: 'drag by the handle; touch-action none',
    assistiveTech:
      'handle is a toggle button (aria-pressed while grabbed) described by hidden instructions; a polite live region announces grab, each move, drop and cancel with the position',
  },
  splitter: {
    keyboard: 'arrows (flipped under RTL), PageUp/PageDown, Home/End',
    pointerTouch: 'drag the separator; RTL measured from the right edge',
    assistiveTech: 'role=separator with aria-valuenow and the separator orientation',
  },
  'signature-pad': {
    keyboard:
      'undo/clear are buttons; drawing is pointer-only by nature — offer a typed alternative',
    pointerTouch: 'pen, touch and mouse strokes with pressure',
    assistiveTech: 'named application region; the value submits through a hidden input',
  },
  'file-upload': {
    keyboard: 'the trigger button opens the picker; retry and remove are buttons',
    pointerTouch: 'drop files or tap the dropzone',
    assistiveTech: 'per-file progressbar, error alert and retry button',
  },
  clipboard: {
    keyboard: 'the trigger is a button; the read-only field selects on focus',
    pointerTouch: 'click/tap the trigger',
    assistiveTech: 'a polite live indicator announces copied or failed',
  },
}

// ─── Joined view ─────────────────────────────────────────────────────────────

export interface SpecializedToolsJoinedScenario {
  readonly productId: string
  readonly displayName: string
  readonly scenarioId: SpecializedToolsScenarioId
  readonly defaultCaseId: string
  readonly cases: readonly SpecializedToolsCompiledCase[]
  readonly presentation: ProductEntry['presentation']
  readonly copiedArtifacts: ProductEntry['copiedArtifacts']
  readonly machine: ProductEntry['machine']
}

export function joinSpecializedToolsScenarios(
  catalog: SpecializedToolsCatalog,
  contract: ProductContract,
): SpecializedToolsJoinedScenario[] {
  const entryByName = new Map(contract.entries.map((entry) => [entry.name, entry]))
  return catalog.scenarios.map((scenario) => {
    const entry = entryByName.get(scenario.productId)
    if (entry === undefined) throw new Error(`No ProductContract entry named ${scenario.productId}`)
    return {
      productId: scenario.productId,
      displayName: entry.displayName,
      scenarioId: scenario.scenarioId,
      defaultCaseId: scenario.defaultCaseId,
      cases: scenario.cases,
      presentation: entry.presentation,
      copiedArtifacts: entry.copiedArtifacts,
      machine: entry.machine,
    }
  })
}

export function isVisuallyApplicable(mode: string): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}

export function applicableSpecializedToolsScenarios(
  joined: readonly SpecializedToolsJoinedScenario[],
  path: SpecializedToolsPath,
): SpecializedToolsJoinedScenario[] {
  return joined.filter(({ presentation }) => isVisuallyApplicable(presentation[path].mode))
}

export function scenarioEnvironmentProductIds(
  joined: readonly SpecializedToolsJoinedScenario[],
  axis: PresentationScenarioEnvironmentAxis,
): string[] {
  return joined
    .filter(({ cases }) => cases.some(({ environmentAxes }) => environmentAxes.includes(axis)))
    .map(({ productId }) => productId)
    .sort()
}
