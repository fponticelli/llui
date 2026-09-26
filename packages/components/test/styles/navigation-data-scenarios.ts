/**
 * The ONE navigation-data family module (#264 phase 2, #270 protocol).
 *
 * `NAVIGATION_DATA_DEFINITIONS` owns every semantic case for the 29
 * navigation-data ProductContract products, keyed by `scenarioId`. Each
 * case's `input` is typed, product-specific JSON mirroring the product's real
 * `init()`/state fields — never a generic `{state, label, ...}` bag. Cases
 * declare the protocol's environment axes (`theme`/`direction`/`motion`/
 * `viewport`/`forcedColors`) they support; the RESOLVER (`resolveScenarioSelection`)
 * supplies the concrete axis value, so one case can be rendered under several
 * environments rather than baking one axis value per case.
 *
 * `compileScenarioFamily` performs the exact join against ProductContract at
 * compile time: a missing or stale scenarioId is a thrown
 * `PresentationScenarioError`, not a silent gap.
 *
 * Two things this module deliberately does NOT own, because they are not
 * protocol data: the forced-colors verification CUE (`FORCED_COLOR_CUES`,
 * consumed only by the shared browser probes) and the density-N/A rationale
 * text (`DENSITY_RATIONALES`) — both are family-local test metadata, kept in
 * plain maps beside the compiled catalog rather than smuggled into a case's
 * `input` (which would fail `compileScenarioFamily`'s exactness check the
 * moment a definition carried anything beyond `id`/`label`/`input`/
 * `environmentAxes`/`copiedArtifactNames`).
 */
import {
  compileScenarioFamily,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioEnvironmentAxis,
  type ResolvedPresentationScenarioSelection,
} from '@llui/cli/presentation-scenarios'
import type { ProductContract, ProductEntry } from '@llui/cli'

// Individual named consts, never a `Record`-typed lookup object: indexing a
// type with an index signature (`Record<string, T>`) widens every property
// read to `T | undefined` under `noUncheckedIndexedAccess`, which then
// silently poisons every case's `environmentAxes` field below with a spurious
// `| undefined` and breaks `compileScenarioFamily`'s exactness check.
const AX = {
  theme: ['theme'] as readonly PresentationScenarioEnvironmentAxis[],
  dir: ['direction'] as readonly PresentationScenarioEnvironmentAxis[],
  motion: ['motion'] as readonly PresentationScenarioEnvironmentAxis[],
  narrow: ['viewport'] as readonly PresentationScenarioEnvironmentAxis[],
  forced: ['forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  themeForced: ['theme', 'forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  dirTheme: ['direction', 'theme'] as readonly PresentationScenarioEnvironmentAxis[],
  dirForced: ['direction', 'forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  dirNarrow: ['direction', 'viewport'] as readonly PresentationScenarioEnvironmentAxis[],
  dirMotion: ['direction', 'motion'] as readonly PresentationScenarioEnvironmentAxis[],
  dirThemeForced: [
    'direction',
    'theme',
    'forcedColors',
  ] as readonly PresentationScenarioEnvironmentAxis[],
  none: [] as readonly PresentationScenarioEnvironmentAxis[],
}

// ---------------------------------------------------------------------------
// component:accordion / component:collapsible — real disclosure state,
// including the `closing` phase driven from the actual reducer (#264 item C):
// AccordionState.closing / CollapsibleState.closing are reducer-owned fields,
// entered by opening then sending `close` with `animated: true` — no
// animation timing involved, so the phase is observable in jsdom too.
export interface DisclosureCaseInput {
  readonly label: string
  readonly content: string
  readonly state: 'closed' | 'open' | 'closing'
  readonly disabled: boolean
}

// component:avatar
export interface AvatarCaseInput {
  readonly label: string
  readonly status: 'loading' | 'loaded' | 'error'
  readonly initials: string
  readonly density: 'comfortable' | 'compact'
}

// component:breadcrumbs
export interface BreadcrumbsCaseInput {
  readonly currentLabel: string
  // No `current` flag: `breadcrumbs.ts` derives it structurally (the LAST
  // item is always current), so there is no state a case could set it to.
  readonly maxVisible: number
}

// component:carousel
export interface CarouselCaseInput {
  readonly index: number
  readonly count: number
  // No standalone "disabled" state: `carousel.ts` has no such init option —
  // prev/next disability is DERIVED from `loop` and the current boundary
  // (`canGoNext`/`canGoPrev`), so that real mechanism is what a case drives.
  readonly loop: boolean
}

// component:chart
export interface ChartCaseInput {
  readonly label: string
  readonly populated: boolean
  /** Isolates one series via the real `setActiveSeries` message (null: show every series). */
  readonly activeSeriesKey: string | null
}

/**
 * The chart/sparkline/table FIXTURE data (the concrete series/rows/points a case merely
 * parameterizes by key/index) lives here ONCE. Phase 1 had both renderers hand-maintain their own
 * `chartSeries`/`chartRows`/`sparkPoints` consts, extended in lockstep on every change (#264 item
 * B) — a single shared export is what the catalog's "data comes from the family once" promise
 * requires for data too big or too structural to fit as a per-case scalar.
 */
export interface ChartFixtureSeries {
  readonly key: string
  readonly label: string
  readonly mark: 'bar' | 'area'
}
export interface ChartFixtureRow {
  readonly label: string
  readonly values: Readonly<Record<string, number>>
}

// THREE bar and THREE area series (#264): the redundant forced-colors cue (a fill pattern per
// data-series-cue) only proves anything with enough same-mark series that a flat
// `fill: CanvasText` would make them identical.
export const CHART_FIXTURE_SERIES: readonly ChartFixtureSeries[] = [
  { key: 'bar1', label: 'Bar A', mark: 'bar' },
  { key: 'bar2', label: 'Bar B', mark: 'bar' },
  { key: 'bar3', label: 'Bar C', mark: 'bar' },
  { key: 'area1', label: 'Area A', mark: 'area' },
  { key: 'area2', label: 'Area B', mark: 'area' },
  { key: 'area3', label: 'Area C', mark: 'area' },
]
export const CHART_FIXTURE_ROWS: readonly ChartFixtureRow[] = [
  { label: 'Q1', values: { bar1: 12, bar2: 9, bar3: 6, area1: 14, area2: 10, area3: 7 } },
  { label: 'Q2', values: { bar1: 18, bar2: 13, bar3: 8, area1: 20, area2: 15, area3: 9 } },
]

export interface SparklineFixturePoint {
  readonly at: number
  readonly value: number
  readonly grain: 'daily' | 'weekly'
}
export const SPARKLINE_FIXTURE_POINTS: readonly SparklineFixturePoint[] = [
  { at: Date.UTC(2026, 0, 1), value: 4, grain: 'daily' },
  { at: Date.UTC(2026, 0, 2), value: 9, grain: 'daily' },
  { at: Date.UTC(2026, 0, 3), value: 6, grain: 'weekly' },
  { at: Date.UTC(2026, 0, 4), value: 12, grain: 'weekly' },
]
export const SPARKLINE_FIXTURE_BAND = Object.freeze({ low: 5, high: 10 })

export interface TableFixtureColumn {
  readonly id: string
  readonly sortable: boolean
}
export const TABLE_FIXTURE_COLUMNS: readonly TableFixtureColumn[] = [
  { id: 'name', sortable: true },
  { id: 'status', sortable: true },
]

// component:marquee
export interface MarqueeCaseInput {
  readonly label: string
  readonly direction: 'left' | 'right' | 'up' | 'down'
  readonly running: boolean
  readonly disabled: boolean
}

// component:meter
export interface MeterCaseInput {
  readonly label: string
  readonly value: number
}

// component:pagination
export interface PaginationCaseInput {
  readonly page: number
  readonly total: number
  readonly disabled: boolean
}

// component:progress
export interface ProgressCaseInput {
  readonly label: string
  readonly value: number | null
}

// component:sparkline
export interface SparklineCaseInput {
  readonly label: string
  // Days AFTER the fixture's last point `now` denotes — sparkline.ts clamps
  // `now` to never precede the last point, so "stale" is the only axis this
  // field can meaningfully express (0 = fresh, >0 = stale by that much).
  readonly nowOffsetDays: number
}

// component:steps
export interface StepsCaseInput {
  readonly current: number
  readonly completed: readonly number[]
  readonly errorStep: number | null
  readonly disabled: boolean
}

// component:table
export interface TableCaseInput {
  readonly rows: readonly string[]
  readonly selection: readonly string[]
  readonly sortColumnId: string | null
  readonly density: 'comfortable' | 'compact'
  readonly disabled: boolean
}

// component:tabs
export interface TabsCaseInput {
  readonly value: 'summary' | 'details'
  readonly orientation: 'horizontal' | 'vertical'
  readonly disabledItems: readonly string[]
}

// component:toc
export interface TocCaseInput {
  readonly activeId: string
  readonly expanded: readonly string[]
}

// component:tree-view
export interface TreeViewCaseInput {
  readonly expanded: readonly string[]
  readonly selected: readonly string[]
  readonly busy: boolean
  readonly disabled: boolean
}

// pattern:data-table
export interface DataTableCaseInput {
  readonly phase: 'loading' | 'error' | 'populated'
  readonly rows: readonly string[]
  readonly density: 'comfortable' | 'compact'
}

// registry:chip
export interface ChipCaseInput {
  readonly label: string
  readonly hue: number | null
}

// registry:alert
export interface AlertCaseInput {
  readonly title: string
  readonly description: string
  readonly variant: 'default' | 'destructive'
}

// registry:badge
export interface BadgeCaseInput {
  readonly label: string
  readonly variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

// registry:card
export interface CardCaseInput {
  readonly title: string
  readonly description: string
  readonly actionLabel: string | null
  readonly sections: readonly string[]
}

// registry:empty
export interface EmptyCaseInput {
  readonly title: string
  readonly description: string
  readonly actionLabel: string | null
}

// registry:item
export interface ItemCaseInput {
  readonly title: string
  readonly description: string
  readonly variant: 'default' | 'outline' | 'muted'
  readonly density: 'comfortable' | 'compact'
}

// registry:kbd
export interface KbdCaseInput {
  readonly keys: readonly string[]
}

// registry:separator
export interface SeparatorCaseInput {
  readonly orientation: 'horizontal' | 'vertical'
  readonly decorative: boolean
}

// registry:skeleton / registry:spinner
export interface BusyCaseInput {
  readonly label: string
}

// registry:typography
export interface TypographyCaseInput {
  readonly title: string
  readonly text: string
  readonly code: string
}

// registry:sidebar
export interface SidebarCaseInput {
  readonly label: string
  readonly current: string
  readonly state: 'expanded' | 'collapsed' | 'offcanvas' | 'mobile'
  readonly density: 'comfortable' | 'compact'
}

/**
 * Every navigation-data case, product-typed, keyed by ProductContract
 * `scenarioId`. Compiled through `compileScenarioFamily` below, which throws
 * unless this object's key set is EXACTLY the family's 29 scenarioIds.
 */
export const NAVIGATION_DATA_DEFINITIONS = {
  'component:accordion': {
    defaultCaseId: 'closed',
    cases: [
      {
        id: 'closed',
        label: 'Closed item',
        input: {
          label: 'Account settings',
          content: 'Profile details',
          state: 'closed',
          disabled: false,
        },
        environmentAxes: AX.dir,
      },
      {
        id: 'open',
        label: 'Open item',
        input: {
          label: 'Account settings',
          content: 'Profile details',
          state: 'open',
          disabled: false,
        },
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Retained closing item',
        input: {
          label: 'Account settings',
          content: 'Profile details',
          state: 'closing',
          disabled: false,
        },
        environmentAxes: AX.motion,
      },
      {
        id: 'disabled',
        label: 'Disabled item',
        input: {
          label: 'Archived settings',
          content: 'Unavailable',
          state: 'closed',
          disabled: true,
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:avatar': {
    defaultCaseId: 'loaded',
    cases: [
      {
        id: 'loading',
        label: 'Loading image',
        input: { label: 'Ada Lovelace', status: 'loading', initials: 'AL', density: 'comfortable' },
        environmentAxes: AX.none,
      },
      {
        id: 'loaded',
        label: 'Loaded image',
        input: { label: 'Ada Lovelace', status: 'loaded', initials: 'AL', density: 'comfortable' },
        environmentAxes: AX.none,
      },
      {
        id: 'fallback',
        label: 'Initials fallback',
        input: { label: 'Ada Lovelace', status: 'error', initials: 'AL', density: 'comfortable' },
        environmentAxes: AX.none,
      },
      {
        id: 'compact',
        label: 'Compact avatar',
        input: { label: 'Ada Lovelace', status: 'error', initials: 'AL', density: 'compact' },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:breadcrumbs': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Breadcrumb trail',
        input: { currentLabel: 'Projects', maxVisible: 4 },
        environmentAxes: AX.dir,
      },
      {
        id: 'current',
        label: 'Current page',
        input: { currentLabel: 'Alignment', maxVisible: 4 },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'collapsed',
        label: 'Collapsed ancestors',
        input: { currentLabel: 'More ancestors', maxVisible: 1 },
        environmentAxes: AX.none,
      },
      {
        id: 'overflow',
        label: 'Long page name',
        input: {
          currentLabel: 'A very long current page name that must truncate',
          maxVisible: 4,
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:carousel': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'First slide',
        input: { index: 0, count: 3, loop: true },
        environmentAxes: AX.dirNarrow,
      },
      {
        id: 'active',
        label: 'Selected indicator',
        input: { index: 1, count: 3, loop: true },
        environmentAxes: AX.none,
      },
      {
        id: 'dragging',
        label: 'Second slide',
        input: { index: 1, count: 3, loop: true },
        environmentAxes: AX.motion,
      },
      {
        id: 'disabled',
        label: 'Boundary controls disabled',
        input: { index: 0, count: 3, loop: false },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:chart': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Six data series (three bar, three area)',
        input: { label: 'Quarterly revenue', populated: true, activeSeriesKey: null },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'active',
        label: 'Active series',
        input: { label: 'Revenue', populated: true, activeSeriesKey: 'bar1' },
        environmentAxes: AX.none,
      },
      {
        id: 'dimmed',
        label: 'Dimmed series',
        input: { label: 'Forecast', populated: true, activeSeriesKey: 'area1' },
        environmentAxes: AX.none,
      },
      {
        id: 'empty',
        label: 'Empty chart',
        input: { label: 'No chart data', populated: false, activeSeriesKey: null },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:collapsible': {
    defaultCaseId: 'closed',
    cases: [
      {
        id: 'closed',
        label: 'Closed details',
        input: { label: 'Details', content: 'Expanded content', state: 'closed', disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'open',
        label: 'Open details',
        input: { label: 'Details', content: 'Expanded content', state: 'open', disabled: false },
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Retained closing details',
        input: { label: 'Details', content: 'Expanded content', state: 'closing', disabled: false },
        environmentAxes: AX.motion,
      },
      {
        id: 'disabled',
        label: 'Disabled details',
        input: { label: 'Details', content: 'Unavailable', state: 'closed', disabled: true },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:marquee': {
    defaultCaseId: 'running',
    cases: [
      {
        id: 'running',
        label: 'Running row',
        input: { label: 'Release updates', direction: 'left', running: true, disabled: false },
        environmentAxes: AX.dirMotion,
      },
      {
        id: 'paused',
        label: 'Paused row',
        input: { label: 'Release updates', direction: 'left', running: false, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'vertical',
        label: 'Vertical column',
        input: { label: 'Release updates', direction: 'up', running: true, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Disabled motion',
        input: { label: 'Release updates', direction: 'left', running: true, disabled: true },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:meter': {
    defaultCaseId: 'neutral',
    cases: [
      {
        id: 'neutral',
        label: 'Neutral value',
        input: { label: 'Storage', value: 42 },
        environmentAxes: AX.dir,
      },
      {
        id: 'optimal',
        label: 'Optimal value',
        input: { label: 'Storage', value: 28 },
        environmentAxes: AX.none,
      },
      {
        id: 'suboptimal',
        label: 'Suboptimal value',
        input: { label: 'Storage', value: 68 },
        environmentAxes: AX.none,
      },
      {
        id: 'critical',
        label: 'Critical value',
        input: { label: 'Storage', value: 92 },
        environmentAxes: AX.themeForced,
      },
    ],
  },
  'component:pagination': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Page controls',
        input: { page: 1, total: 10, disabled: false },
        environmentAxes: AX.dirNarrow,
      },
      {
        id: 'current',
        label: 'Current page',
        input: { page: 2, total: 10, disabled: false },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'ellipsis',
        label: 'Collapsed page range',
        input: { page: 5, total: 20, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Boundary disabled',
        input: { page: 1, total: 1, disabled: true },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:progress': {
    defaultCaseId: 'loading',
    cases: [
      {
        id: 'loading',
        label: 'Upload progress',
        input: { label: 'Uploading', value: 60 },
        environmentAxes: AX.none,
      },
      {
        id: 'complete',
        label: 'Completed progress',
        input: { label: 'Complete', value: 100 },
        environmentAxes: AX.none,
      },
      {
        id: 'indeterminate',
        label: 'Indeterminate progress',
        input: { label: 'Loading', value: null },
        environmentAxes: AX.motion,
      },
    ],
  },
  'component:sparkline': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Trend series',
        input: { label: 'Weekly trend', nowOffsetDays: 0 },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'stale',
        label: 'Stale series',
        input: { label: 'Weekly trend', nowOffsetDays: 1 },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:steps': {
    defaultCaseId: 'current',
    cases: [
      {
        id: 'pending',
        label: 'Pending step',
        input: { current: 0, completed: [], errorStep: null, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'current',
        label: 'Current step',
        input: { current: 1, completed: [0], errorStep: null, disabled: false },
        environmentAxes: AX.dirThemeForced,
      },
      {
        id: 'completed',
        label: 'Completed step',
        input: { current: 2, completed: [0, 1], errorStep: null, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'error',
        label: 'Failed step',
        input: { current: 1, completed: [0], errorStep: 1, disabled: false },
        environmentAxes: AX.forced,
      },
      {
        id: 'disabled',
        label: 'Disabled step',
        input: { current: 0, completed: [], errorStep: null, disabled: true },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:table': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Data grid',
        input: {
          rows: ['alpha', 'beta'],
          selection: [],
          sortColumnId: null,
          density: 'comfortable',
          disabled: false,
        },
        environmentAxes: AX.dirNarrow,
      },
      {
        id: 'selected',
        label: 'Selected row',
        input: {
          rows: ['alpha', 'beta'],
          selection: ['alpha'],
          sortColumnId: null,
          density: 'comfortable',
          disabled: false,
        },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'sorted',
        label: 'Sorted column',
        input: {
          rows: ['alpha', 'beta'],
          selection: [],
          sortColumnId: 'name',
          density: 'comfortable',
          disabled: false,
        },
        environmentAxes: AX.none,
      },
      {
        id: 'empty',
        label: 'Empty rows',
        input: {
          rows: [],
          selection: [],
          sortColumnId: null,
          density: 'comfortable',
          disabled: false,
        },
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Disabled row',
        input: {
          rows: ['alpha', 'beta'],
          selection: [],
          sortColumnId: null,
          density: 'comfortable',
          disabled: true,
        },
        environmentAxes: AX.none,
      },
      {
        id: 'compact',
        label: 'Compact data grid',
        input: {
          rows: ['alpha', 'beta'],
          selection: [],
          sortColumnId: null,
          density: 'compact',
          disabled: false,
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:tabs': {
    defaultCaseId: 'active',
    cases: [
      {
        id: 'inactive',
        label: 'Inactive tab',
        input: { value: 'summary', orientation: 'horizontal', disabledItems: [] },
        environmentAxes: AX.none,
      },
      {
        id: 'active',
        label: 'Active tab',
        input: { value: 'details', orientation: 'horizontal', disabledItems: [] },
        environmentAxes: AX.dirThemeForced,
      },
      {
        id: 'disabled',
        label: 'Disabled tab',
        input: { value: 'summary', orientation: 'horizontal', disabledItems: ['summary'] },
        environmentAxes: AX.none,
      },
      {
        id: 'vertical',
        label: 'Vertical tabs',
        input: { value: 'details', orientation: 'vertical', disabledItems: [] },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:toc': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Document outline',
        input: { activeId: 'overview', expanded: [] },
        environmentAxes: AX.dir,
      },
      {
        id: 'current',
        label: 'Current section',
        input: { activeId: 'api', expanded: [] },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'collapsed',
        label: 'Collapsed branch',
        input: { activeId: 'overview', expanded: [] },
        environmentAxes: AX.none,
      },
      {
        id: 'expanded',
        label: 'Expanded branch',
        input: { activeId: 'overview', expanded: ['api'] },
        environmentAxes: AX.none,
      },
    ],
  },
  'component:tree-view': {
    defaultCaseId: 'collapsed',
    cases: [
      {
        id: 'collapsed',
        label: 'Collapsed branch',
        input: { expanded: [], selected: [], busy: false, disabled: false },
        environmentAxes: AX.dir,
      },
      {
        id: 'expanded',
        label: 'Expanded branch',
        input: { expanded: ['src'], selected: [], busy: false, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'selected',
        label: 'Selected item',
        input: { expanded: ['src'], selected: ['index'], busy: false, disabled: false },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'loading',
        label: 'Loading branch',
        input: { expanded: [], selected: [], busy: true, disabled: false },
        environmentAxes: AX.none,
      },
      {
        id: 'disabled',
        label: 'Disabled item',
        input: { expanded: [], selected: [], busy: false, disabled: true },
        environmentAxes: AX.none,
      },
    ],
  },
  'pattern:data-table': {
    defaultCaseId: 'populated',
    cases: [
      {
        id: 'loading',
        label: 'Loading data',
        input: { phase: 'loading', rows: [], density: 'comfortable' },
        environmentAxes: AX.none,
      },
      {
        id: 'empty',
        label: 'No results',
        input: { phase: 'populated', rows: [], density: 'comfortable' },
        environmentAxes: AX.none,
      },
      {
        id: 'error',
        label: 'Load failed',
        input: { phase: 'error', rows: [], density: 'comfortable' },
        environmentAxes: AX.themeForced,
      },
      {
        id: 'populated',
        label: 'Loaded rows',
        input: { phase: 'populated', rows: ['alpha', 'beta'], density: 'comfortable' },
        environmentAxes: AX.narrow,
      },
      {
        id: 'compact',
        label: 'Compact loaded rows',
        input: { phase: 'populated', rows: ['alpha', 'beta'], density: 'compact' },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:chip': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Default chip',
        input: { label: 'Lab', hue: null },
        environmentAxes: AX.none,
      },
      {
        id: 'categorical',
        label: 'Categorical chip',
        input: { label: 'Design', hue: 188.5 },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:alert': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Information alert',
        input: { title: 'Saved', description: 'Changes are live', variant: 'default' },
        environmentAxes: AX.none,
      },
      {
        id: 'destructive',
        label: 'Error alert',
        input: { title: 'Sync failed', description: 'Try again', variant: 'destructive' },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:badge': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Default badge',
        input: { label: 'Stable', variant: 'default' },
        environmentAxes: AX.none,
      },
      {
        id: 'secondary',
        label: 'Secondary badge',
        input: { label: 'Preview', variant: 'secondary' },
        environmentAxes: AX.none,
      },
      {
        id: 'destructive',
        label: 'Destructive badge',
        input: { label: 'Failed', variant: 'destructive' },
        environmentAxes: AX.none,
      },
      {
        id: 'outline',
        label: 'Outline badge',
        input: { label: 'Draft', variant: 'outline' },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:card': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Content card',
        input: { title: 'Release', description: 'Ready', actionLabel: null, sections: [] },
        environmentAxes: AX.none,
      },
      {
        id: 'with-action',
        label: 'Card with action',
        input: { title: 'Release', description: 'Ready', actionLabel: 'Open', sections: [] },
        environmentAxes: AX.none,
      },
      {
        id: 'divided',
        label: 'Divided card',
        input: {
          title: 'Release',
          description: 'Ready',
          actionLabel: null,
          sections: ['Summary', 'Details'],
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:empty': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Empty collection',
        input: { title: 'Nothing here', description: 'Create the first item', actionLabel: null },
        environmentAxes: AX.none,
      },
      {
        id: 'with-action',
        label: 'Empty collection action',
        input: {
          title: 'Nothing here',
          description: 'Create the first item',
          actionLabel: 'Add item',
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:item': {
    defaultCaseId: 'default',
    cases: [
      {
        id: 'default',
        label: 'Content item',
        input: {
          title: 'Deployment',
          description: 'Completed',
          variant: 'default',
          density: 'comfortable',
        },
        environmentAxes: AX.none,
      },
      {
        id: 'interactive',
        label: 'Interactive item',
        input: {
          title: 'Deployment',
          description: 'Completed',
          variant: 'outline',
          density: 'comfortable',
        },
        environmentAxes: AX.none,
      },
      {
        id: 'muted',
        label: 'Muted item',
        input: {
          title: 'Deployment',
          description: 'Completed',
          variant: 'muted',
          density: 'comfortable',
        },
        environmentAxes: AX.none,
      },
      {
        id: 'compact',
        label: 'Compact content item',
        input: {
          title: 'Deployment',
          description: 'Completed',
          variant: 'default',
          density: 'compact',
        },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:kbd': {
    defaultCaseId: 'single',
    cases: [
      { id: 'single', label: 'Single key', input: { keys: ['K'] }, environmentAxes: AX.none },
      {
        id: 'chord',
        label: 'Keyboard chord',
        input: { keys: ['Meta', 'K'] },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:separator': {
    defaultCaseId: 'horizontal',
    cases: [
      {
        id: 'horizontal',
        label: 'Horizontal separator',
        input: { orientation: 'horizontal', decorative: true },
        environmentAxes: AX.forced,
      },
      {
        id: 'vertical',
        label: 'Vertical separator',
        input: { orientation: 'vertical', decorative: true },
        environmentAxes: AX.forced,
      },
      {
        id: 'semantic',
        label: 'Semantic separator',
        input: { orientation: 'horizontal', decorative: false },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:skeleton': {
    defaultCaseId: 'loading',
    cases: [
      {
        id: 'loading',
        label: 'Loading placeholder',
        input: { label: 'Loading content' },
        environmentAxes: AX.motion,
      },
    ],
  },
  'registry:spinner': {
    defaultCaseId: 'loading',
    cases: [
      {
        id: 'loading',
        label: 'Loading spinner',
        input: { label: 'Loading' },
        environmentAxes: AX.motion,
      },
    ],
  },
  'registry:typography': {
    defaultCaseId: 'body',
    cases: [
      {
        id: 'headings',
        label: 'Heading hierarchy',
        input: { title: 'Navigation data', text: '', code: '' },
        environmentAxes: AX.none,
      },
      {
        id: 'body',
        label: 'Body copy',
        input: { title: '', text: 'Readable body content', code: '' },
        environmentAxes: AX.dir,
      },
      {
        id: 'code',
        label: 'Long code token',
        input: {
          title: '',
          text: '',
          code: 'veryLongUnbrokenIdentifierThatMustRemainLocallyScrollable',
        },
        environmentAxes: AX.narrow,
      },
      {
        id: 'quote',
        label: 'Block quotation',
        input: { title: '', text: 'Clarity over cleverness', code: '' },
        environmentAxes: AX.none,
      },
    ],
  },
  'registry:sidebar': {
    defaultCaseId: 'expanded',
    cases: [
      {
        id: 'expanded',
        label: 'Expanded sidebar',
        input: {
          label: 'Workspace',
          current: 'Overview',
          state: 'expanded',
          density: 'comfortable',
        },
        environmentAxes: AX.dir,
      },
      {
        id: 'compact',
        label: 'Compact sidebar navigation',
        input: { label: 'Workspace', current: 'Overview', state: 'expanded', density: 'compact' },
        environmentAxes: AX.none,
      },
      {
        id: 'collapsed',
        label: 'Collapsed sidebar',
        input: {
          label: 'Workspace',
          current: 'Overview',
          state: 'collapsed',
          density: 'comfortable',
        },
        environmentAxes: AX.none,
      },
      {
        id: 'offcanvas',
        label: 'Off-canvas sidebar',
        input: {
          label: 'Workspace',
          current: 'Overview',
          state: 'offcanvas',
          density: 'comfortable',
        },
        environmentAxes: AX.narrow,
      },
      {
        id: 'mobile',
        label: 'Mobile sidebar',
        input: { label: 'Workspace', current: 'Overview', state: 'mobile', density: 'comfortable' },
        environmentAxes: AX.narrow,
      },
    ],
  },
} as const

export type NavigationDataDefinitions = typeof NAVIGATION_DATA_DEFINITIONS
export type NavigationDataCatalog = CompiledPresentationScenarioFamily<NavigationDataDefinitions>
export type NavigationDataScenario = NavigationDataCatalog['scenarios'][number]
export type NavigationDataCase = NavigationDataScenario['cases'][number]
export type NavigationDataResolved =
  ResolvedPresentationScenarioSelection<NavigationDataDefinitions>
export type NavigationDataScenarioId = keyof NavigationDataDefinitions & string
export type NavigationDataPath = 'baseline' | 'registryTailwind'

/** Compile the family catalog against a real ProductContract. Throws a
 * `PresentationScenarioError` if the contract's navigation-data products and
 * this module's keys are not in exact agreement (missing or stale). */
export function compileNavigationDataCatalog(contract: ProductContract): NavigationDataCatalog {
  return compileScenarioFamily(contract, 'navigation-data', NAVIGATION_DATA_DEFINITIONS)
}

/**
 * Non-colour verification cue `probeForcedColorCues` (navigation-data-browser-probes.ts)
 * uses to decide which structural signal proves a forced-colors case is still
 * legible without relying on colour. Test metadata, not protocol data.
 */
export type ForcedColorCue =
  | 'outline-selection'
  | 'underline-current'
  | 'status-error'
  | 'series-distinction'
  | 'orientation'

export const FORCED_COLOR_CUES: Readonly<Record<NavigationDataScenarioId, ForcedColorCue>> = {
  'component:accordion': 'outline-selection',
  'component:avatar': 'outline-selection',
  'component:breadcrumbs': 'underline-current',
  'component:carousel': 'outline-selection',
  'component:chart': 'series-distinction',
  'component:collapsible': 'outline-selection',
  'component:marquee': 'orientation',
  'component:meter': 'series-distinction',
  'component:pagination': 'outline-selection',
  'component:progress': 'orientation',
  'component:sparkline': 'series-distinction',
  'component:steps': 'status-error',
  'component:table': 'outline-selection',
  'component:tabs': 'outline-selection',
  'component:toc': 'underline-current',
  'component:tree-view': 'outline-selection',
  'pattern:data-table': 'status-error',
  'registry:chip': 'series-distinction',
  'registry:alert': 'status-error',
  'registry:badge': 'outline-selection',
  'registry:card': 'outline-selection',
  'registry:empty': 'outline-selection',
  'registry:item': 'outline-selection',
  'registry:kbd': 'outline-selection',
  'registry:separator': 'orientation',
  'registry:skeleton': 'orientation',
  'registry:spinner': 'orientation',
  'registry:typography': 'underline-current',
  'registry:sidebar': 'outline-selection',
}

/**
 * Products whose collection density (`comfortable`/`compact`) is a real,
 * distinct axis in their machine's `connect()` options or their skin's own
 * variant surface. Every other product is genuinely N/A: falsifiable by the
 * renderer-level test asserting no rendered case ever carries
 * `[data-density]` for it (`navigation-data-baseline-renderer.test.ts` /
 * `navigation-data-scenario-renderer.test.ts`), not merely asserted here.
 *
 * Two-level, not three, for all five (#264 review item 4) — checked against
 * each product's REAL skin surface rather than assumed:
 * - `avatar` / `table`: the registry recipe's own Tailwind size scale genuinely
 *   has a third rung (`registry/llui/ui/avatar.ts`'s `data-[size=lg]`,
 *   shadcn's `lg` avatar), but the BASELINE stylesheet
 *   (`packages/components/src/styles/data-display.css`) has only ONE
 *   `[data-density='compact']` override each — no `lg`-equivalent rule
 *   exists there, so a third level would apply to registryTailwind only,
 *   breaking the family's own "both rendering paths exercise the same
 *   cases" contract. Two is the level BOTH skins actually share.
 * - `data-table`: forwards `density` straight to its composed `table`, so it
 *   inherits that limit.
 * - `item`: `registry/llui/ui/item.ts`'s `createVariants` genuinely defines
 *   only `size: { default, sm }` — there IS no third rung to exercise.
 * - `sidebar`: registry-only (no baseline counterpart at all), and its
 *   `SidebarMenuButton` recipe DOES define a third `lg` rung
 *   (`registry/llui/ui/sidebar.ts`) that this family's scenarios
 *   deliberately never reach. Left at two anyway, for symmetry with `item`
 *   — the family's OTHER registry-only presentational atom — rather than
 *   making sidebar alone a three-level product with no dual-skin
 *   counterpart to compare it against; `sidebar`'s unused `lg` rung is a
 *   real (if minor) skin/test-coverage gap, tracked here rather than
 *   silently invented into a mismatched third case.
 */
export const DENSITY_APPLICABLE_PRODUCT_IDS: readonly string[] = [
  'avatar',
  'table',
  'data-table',
  'item',
  'sidebar',
].sort()

/**
 * Per-product density-N/A rationale (#264 item 6): a single shared template
 * ("has no collection-density input") was true of all 24 non-applicable
 * products but named none of them specifically, and could not be falsified
 * beyond `.toContain(displayName)`. Each rationale below instead names the
 * REAL fact backing it — either "this machine's `connect()` options carry no
 * density/size field" (public-machine products) or "this registry atom has no
 * machine at all" (presentational products) — and `checkedSources` names the
 * exact repo-relative source file(s) `navigation-data-contract.test.ts` reads
 * and asserts never mention density/size geometry, so a rationale can no
 * longer go stale the day a product grows one.
 */
export interface DensityRationale {
  readonly text: string
  readonly checkedSources: readonly string[]
}

function noMachineDensityOption(productId: string, displayName: string): DensityRationale {
  return {
    text: `${displayName}'s connect() options expose no density/size field, and neither the baseline stylesheet nor the registry ${productId}.ts skin varies its geometry on one; its box is fixed and only its content/state cases vary.`,
    checkedSources: [
      `packages/components/src/components/${productId}.ts`,
      `registry/llui/ui/${productId}.ts`,
    ],
  }
}

function noMachineAtAll(
  productId: string,
  displayName: string,
  recipeFile: string,
): DensityRationale {
  return {
    text: `${displayName} has no machine at all (its ProductContract entry is machine-free); its registry ${recipeFile}.ts recipe fixes one padding/size scale with no size variant to select.`,
    checkedSources: [`registry/llui/ui/${recipeFile}.ts`],
  }
}

export const DENSITY_RATIONALES: Readonly<Record<string, DensityRationale>> = {
  accordion: noMachineDensityOption('accordion', 'Accordion'),
  breadcrumbs: {
    text: `Breadcrumbs' connect() options expose no density/size field; overflow is handled by \`maxVisible\` truncation rather than a smaller box, and neither the baseline stylesheet nor the registry breadcrumb.ts skin varies item size.`,
    checkedSources: [
      'packages/components/src/components/breadcrumbs.ts',
      'registry/llui/ui/breadcrumb.ts',
    ],
  },
  carousel: noMachineDensityOption('carousel', 'Carousel'),
  chart: noMachineDensityOption('chart', 'Chart'),
  collapsible: noMachineDensityOption('collapsible', 'Collapsible'),
  marquee: noMachineDensityOption('marquee', 'Marquee'),
  meter: noMachineDensityOption('meter', 'Meter'),
  pagination: noMachineDensityOption('pagination', 'Pagination'),
  progress: noMachineDensityOption('progress', 'Progress'),
  sparkline: noMachineDensityOption('sparkline', 'Sparkline'),
  steps: noMachineDensityOption('steps', 'Steps'),
  tabs: noMachineDensityOption('tabs', 'Tabs'),
  toc: noMachineDensityOption('toc', 'Table of Contents'),
  'tree-view': noMachineDensityOption('tree-view', 'Tree View'),
  alert: noMachineAtAll('alert', 'Alert', 'alert'),
  badge: noMachineAtAll('badge', 'Badge', 'badge'),
  card: noMachineAtAll('card', 'Card', 'card'),
  chip: noMachineAtAll('chip', 'Chip', 'chip'),
  empty: noMachineAtAll('empty', 'Empty', 'empty'),
  kbd: noMachineAtAll('kbd', 'Kbd', 'kbd'),
  separator: noMachineAtAll('separator', 'Separator', 'separator'),
  skeleton: {
    text: `Skeleton has no machine at all (its ProductContract entry is machine-free); its registry skeleton.ts recipe takes its size from the content it stands in for, never from a density switch.`,
    checkedSources: ['registry/llui/ui/skeleton.ts'],
  },
  spinner: noMachineAtAll('spinner', 'Spinner', 'spinner'),
  typography: {
    text: `Typography has no machine at all (its ProductContract entry is machine-free); its registry typography.ts recipe fixes one type scale per heading/body/code variant, never a density switch.`,
    checkedSources: ['registry/llui/ui/typography.ts'],
  },
} as const

export function densityRationale(entry: ProductEntry): string {
  const rationale = DENSITY_RATIONALES[entry.name]
  if (rationale === undefined) {
    throw new Error(`No density rationale registered for product ${entry.name}`)
  }
  return rationale.text
}

/** One navigation-data scenario joined with its ProductContract entry — the
 * ergonomic shape browser-probe test files consume (`productId`,
 * `presentation`, `copiedArtifacts` alongside the compiled cases). */
export interface NavigationDataJoinedScenario {
  readonly productId: string
  readonly displayName: string
  readonly scenarioId: NavigationDataScenarioId
  readonly defaultCaseId: string
  readonly cases: readonly NavigationDataCase[]
  readonly presentation: ProductEntry['presentation']
  readonly copiedArtifacts: ProductEntry['copiedArtifacts']
  readonly machine: ProductEntry['machine']
}

export function joinNavigationDataScenarios(
  catalog: NavigationDataCatalog,
  contract: ProductContract,
): NavigationDataJoinedScenario[] {
  const entryByName = new Map(contract.entries.map((entry) => [entry.name, entry]))
  return catalog.scenarios.map((scenario) => {
    const entry = entryByName.get(scenario.productId)
    if (entry === undefined) {
      throw new Error(`No ProductContract entry named ${scenario.productId}`)
    }
    return {
      productId: scenario.productId,
      displayName: entry.displayName,
      scenarioId: scenario.scenarioId as NavigationDataScenarioId,
      defaultCaseId: scenario.defaultCaseId,
      cases: scenario.cases,
      presentation: entry.presentation,
      copiedArtifacts: entry.copiedArtifacts,
      machine: entry.machine,
    }
  })
}

function isVisuallyApplicable(mode: string): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}

export function applicableNavigationDataScenarios(
  joined: readonly NavigationDataJoinedScenario[],
  path: NavigationDataPath,
): NavigationDataJoinedScenario[] {
  return joined.filter(({ presentation }) => isVisuallyApplicable(presentation[path].mode))
}

/** Product ids with at least one case declaring support for `axisName` — the
 * concrete axis VALUE is supplied later, at resolve time, by the caller. */
export function scenarioEnvironmentProductIds(
  joined: readonly NavigationDataJoinedScenario[],
  axisName: PresentationScenarioEnvironmentAxis,
): string[] {
  return joined
    .filter(({ cases }) => cases.some(({ environmentAxes }) => environmentAxes.includes(axisName)))
    .map(({ productId }) => productId)
    .sort()
}

export function forcedColorScenarios(
  joined: readonly NavigationDataJoinedScenario[],
): { productId: string; cue: ForcedColorCue }[] {
  return joined
    .filter(({ cases }) =>
      cases.some(({ environmentAxes }) => environmentAxes.includes('forcedColors')),
    )
    .map(({ productId, scenarioId }) => ({ productId, cue: FORCED_COLOR_CUES[scenarioId] }))
    .sort((left, right) => left.productId.localeCompare(right.productId))
}
