import {
  button,
  component,
  div,
  each,
  mountApp,
  span,
  text,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import {
  resolveScenarioSelection,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import * as accordion from '@llui/components/accordion'
import * as avatar from '@llui/components/avatar'
import * as breadcrumbs from '@llui/components/breadcrumbs'
import * as carousel from '@llui/components/carousel'
import * as chart from '@llui/components/chart'
import { chartForcedColorPatterns } from '@llui/components/chart'
import * as collapsible from '@llui/components/collapsible'
import * as marquee from '@llui/components/marquee'
import * as meter from '@llui/components/meter'
import * as pagination from '@llui/components/pagination'
import * as progress from '@llui/components/progress'
import * as sparkline from '@llui/components/sparkline'
import * as steps from '@llui/components/steps'
import * as table from '@llui/components/table'
import * as tabs from '@llui/components/tabs'
import * as toc from '@llui/components/toc'
import * as treeView from '@llui/components/tree-view'
import * as dataTable from '@llui/components/patterns/data-table'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../llui/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '../llui/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '../llui/ui/avatar'
import { Badge } from '../llui/ui/badge'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '../llui/ui/breadcrumb'
import {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselIndicatorGroup,
  CarouselNext,
  CarouselPrevious,
  CarouselSlide,
  CarouselViewport,
} from '../llui/ui/carousel'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../llui/ui/card'
import {
  ChartAxisLabel,
  ChartContainer,
  ChartDesc,
  ChartDot,
  ChartGrid,
  ChartLayer,
  ChartLegend,
  ChartLegendItem,
  ChartLegendSwatch,
  ChartMark,
  ChartSvg,
  ChartTable,
  ChartTableBody,
  ChartTableCell,
  ChartTableRow,
  ChartTitle,
  ChartTooltipContent,
} from '../llui/ui/chart'
import { Chip } from '../llui/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../llui/ui/collapsible'
import {
  DataTableEmptyDescription,
  DataTableEmptyState,
  DataTableEmptyTitle,
  DataTableErrorState,
  DataTableLoadingOverlay,
} from '../llui/ui/data-table'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../llui/ui/empty'
import { Item, ItemContent, ItemDescription, ItemTitle } from '../llui/ui/item'
import { Kbd, KbdGroup } from '../llui/ui/kbd'
import { Marquee, MarqueeContent } from '../llui/ui/marquee'
import { Meter, MeterBand, MeterLabel, MeterMarker, MeterRange, MeterTrack } from '../llui/ui/meter'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../llui/ui/pagination'
import { Progress, ProgressLabel, ProgressRange, ProgressTrack } from '../llui/ui/progress'
import { Separator } from '../llui/ui/separator'
import { Skeleton } from '../llui/ui/skeleton'
import {
  Sidebar,
  SidebarContainer,
  SidebarContent,
  SidebarGap,
  SidebarHeader,
  SidebarInner,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMobile,
  SidebarProvider,
} from '../llui/ui/sidebar'
import {
  Sparkline,
  SparklineBand,
  SparklineDesc,
  SparklineDot,
  SparklineGrid,
  SparklineLayer,
  SparklineLine,
  SparklineNow,
  SparklineSpan,
  SparklineSvg,
  SparklineTable,
  SparklineTableBody,
  SparklineTableCell,
  SparklineTableRow,
  SparklineTitle,
  SparklineTooltip,
} from '../llui/ui/sparkline'
import { Spinner } from '../llui/ui/spinner'
import { Steps, StepsItem, StepsSeparator, StepsTrigger } from '../llui/ui/steps'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../llui/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../llui/ui/tabs'
import { Toc, TocExpandTrigger, TocItem, TocLink, TocList } from '../llui/ui/toc'
import {
  TreeView,
  TreeViewBranchTrigger,
  TreeViewCheckbox,
  TreeViewItem,
} from '../llui/ui/tree-view'
import {
  TypographyBlockquote,
  TypographyH2,
  TypographyInlineCode,
  TypographyList,
  TypographyListItem,
  TypographyP,
  TypographyPre,
} from '../llui/ui/typography'
import {
  applicableNavigationDataScenarios,
  joinNavigationDataScenarios,
  CHART_FIXTURE_ROWS,
  CHART_FIXTURE_SERIES,
  SPARKLINE_FIXTURE_BAND,
  SPARKLINE_FIXTURE_POINTS,
  TABLE_FIXTURE_COLUMNS,
  type AlertCaseInput,
  type AvatarCaseInput,
  type BadgeCaseInput,
  type BreadcrumbsCaseInput,
  type BusyCaseInput,
  type CardCaseInput,
  type CarouselCaseInput,
  type ChartCaseInput,
  type ChipCaseInput,
  type DataTableCaseInput,
  type DisclosureCaseInput,
  type EmptyCaseInput,
  type ItemCaseInput,
  type KbdCaseInput,
  type MarqueeCaseInput,
  type MeterCaseInput,
  type NavigationDataCatalog,
  type NavigationDataDefinitions,
  type NavigationDataJoinedScenario,
  type NavigationDataScenarioId,
  type PaginationCaseInput,
  type ProgressCaseInput,
  type SeparatorCaseInput,
  type SidebarCaseInput,
  type SparklineCaseInput,
  type StepsCaseInput,
  type TableCaseInput,
  type TabsCaseInput,
  type TocCaseInput,
  type TreeViewCaseInput,
  type TypographyCaseInput,
} from '../../packages/components/test/styles/navigation-data-scenarios'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: NavigationDataScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

/** See `navigation-data-baseline-renderer.ts`'s identical doc: an adapter
 * renders ONE typed, product-specific input through the real machine ->
 * connect -> registry skin, decoupled from resolution so a dimension-mutation
 * test can call it directly with a hand-mutated input. */
export type Adapter<Input> = (host: HTMLElement, input: Input, ctx: RenderContext) => Disposable

/** See `navigation-data-baseline-renderer.ts`'s identical doc: applies the
 * resolved environment to the case's own mount host — `dir`/`data-theme`/
 * `data-viewport`/`data-forced-colors` are universal, `motion` is wired
 * per-product below where a machine has an `animated` option to gate. */
function applyEnvironmentAttrs(
  host: HTMLElement,
  environment: PresentationScenarioEnvironment,
): void {
  host.setAttribute('dir', environment.direction)
  host.dataset.theme = environment.theme
  host.dataset.viewport = environment.viewport
  host.dataset.forcedColors = environment.forcedColors
}

function mountMachine<S, M extends { type: string }, E extends { type: string } = never>(
  host: HTMLElement,
  ctx: RenderContext,
  name: string,
  initial: () => S,
  update: (state: S, msg: M) => [S, E[]],
  view: (state: Signal<S>, send: Send<M>) => Mountable | readonly Mountable[],
): Disposable {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<S, M, E>({
      name,
      init: () => [initial(), []],
      update,
      view: ({ state, send }) => {
        const rendered = view(state, send)
        return Array.isArray(rendered) ? rendered : [rendered]
      },
    }),
  )
}

/** `animated` follows the resolved `motion` axis — see the baseline renderer's
 * identical doc for why. */
function initDisclosureAccordion(
  itemValue: string,
  input: DisclosureCaseInput,
  environment: PresentationScenarioEnvironment,
): accordion.AccordionState {
  const animated = environment.motion !== 'reduced'
  const opened = accordion.init({
    items: [itemValue],
    value: [itemValue],
    disabled: input.disabled,
    animated,
  })
  if (input.state === 'open') return opened
  if (input.state === 'closing')
    return accordion.update(opened, { type: 'close', value: itemValue })[0]
  return accordion.init({ items: [itemValue], value: [], disabled: input.disabled, animated })
}

function initDisclosureCollapsible(
  input: DisclosureCaseInput,
  environment: PresentationScenarioEnvironment,
): collapsible.CollapsibleState {
  const animated = environment.motion !== 'reduced'
  const opened = collapsible.init({ open: true, disabled: input.disabled, animated })
  if (input.state === 'open') return opened
  if (input.state === 'closing') return collapsible.update(opened, { type: 'close' })[0]
  return collapsible.init({ open: false, disabled: input.disabled, animated })
}

const accordionAdapter: Adapter<DisclosureCaseInput> = (host, input, ctx) => {
  const itemValue = 'item'
  return mountMachine(
    host,
    ctx,
    'RegistryAccordionScenario',
    () => initDisclosureAccordion(itemValue, input, ctx.environment),
    accordion.update,
    (state, send) => {
      const parts = accordion.connect(state, send, { id: `registry-accordion-${ctx.caseId}` })
      const item = parts.item(itemValue)
      return Accordion({ ...parts.root, exitCompletion: parts.exitCompletion }, [
        AccordionItem({ ...item.item }, [
          AccordionTrigger({ ...item.trigger }, [text(input.label)]),
          AccordionContent({ ...item.content }, [text(input.content)]),
        ]),
      ])
    },
  )
}

const collapsibleAdapter: Adapter<DisclosureCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryCollapsibleScenario',
    () => initDisclosureCollapsible(input, ctx.environment),
    collapsible.update,
    (state, send) => {
      const parts = collapsible.connect(state, send, { id: `registry-collapsible-${ctx.caseId}` })
      return Collapsible({ ...parts.root, exitCompletion: parts.exitCompletion }, [
        CollapsibleTrigger({ ...parts.trigger }, [text(input.label)]),
        CollapsibleContent({ ...parts.content }, [text(input.content)]),
      ])
    },
  )

const avatarAdapter: Adapter<AvatarCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryAvatarScenario',
    () => ({ ...avatar.init(), status: input.status }),
    avatar.update,
    (state, send) => {
      void ctx
      const parts = avatar.connect(state, send, { alt: input.label, density: input.density })
      // `'data-size'` is NOT a decorative echo of the machine's own
      // `data-density` (which this recipe never reads at all) — it is the
      // REQUIRED adapter-level translation from the machine's generic
      // `density` option to `avatar.ts`'s own shadcn-ported `data-size`
      // convention, exactly as that file's own doc comment states
      // (`@llui/components/avatar` does not publish `data-size` itself).
      // Removing it as though it were redundant with `data-density` was a
      // real regression this fix corrects (#264 review, caught by the
      // Chromium geometry test: compact and default rendered the SAME
      // pixel width once this line was gone).
      return Avatar(
        { ...parts.root, 'data-size': input.density === 'compact' ? 'sm' : 'default' },
        [
          AvatarImage({ ...parts.image, src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
          AvatarFallback({ ...parts.fallback }, [text(input.initials)]),
        ],
      )
    },
  )

const breadcrumbsAdapter: Adapter<BreadcrumbsCaseInput> = (host, input, ctx) => {
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'current', label: input.currentLabel },
  ]
  return mountMachine(
    host,
    ctx,
    'RegistryBreadcrumbScenario',
    () => breadcrumbs.init({ items, maxVisible: input.maxVisible }),
    breadcrumbs.update,
    (state, send) => {
      void ctx
      const parts = breadcrumbs.connect(state, send)
      // Driven from the real `visibleItems(state)` projection — see the
      // baseline renderer's identical comment.
      return Breadcrumb({ ...parts.root }, [
        BreadcrumbList({ ...parts.list }, [
          each(state.map(breadcrumbs.visibleItems), {
            key: (entry) => (entry.type === 'ellipsis' ? 'ellipsis' : entry.id),
            render: (entry, index) => {
              const value = entry.peek()
              const separator =
                index.peek() > 0 ? [BreadcrumbSeparator({ ...parts.separator })] : []
              if (value.type === 'ellipsis') {
                return [
                  ...separator,
                  BreadcrumbItem([BreadcrumbEllipsis({ ...parts.ellipsisTrigger }, [text('…')])]),
                ]
              }
              return [
                ...separator,
                BreadcrumbItem({ ...parts.item(value.id) }, [
                  BreadcrumbLink({ ...parts.link(value.id), href: `#${value.id}` }, [
                    text(value.label),
                  ]),
                ]),
              ]
            },
          }),
        ]),
      ])
    },
  )
}

const carouselAdapter: Adapter<CarouselCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryCarouselScenario',
    () => carousel.init({ count: input.count, current: input.index, loop: input.loop }),
    carousel.update,
    (state, send) => {
      const parts = carousel.connect(state, send, { id: `registry-carousel-${ctx.caseId}` })
      const slides = Array.from({ length: input.count }, (_, index) => index)
      return [
        parts.directionSync,
        Carousel({ ...parts.root }, [
          CarouselViewport({ ...parts.viewport }, [
            CarouselContent(
              { ...parts.track },
              slides.map((index) =>
                CarouselSlide({ ...parts.slide(index).slide }, [text(`Slide ${index + 1}`)]),
              ),
            ),
          ]),
          CarouselPrevious({ ...parts.prevTrigger }),
          CarouselIndicatorGroup(
            { ...parts.indicatorGroup },
            slides.map((index) => CarouselIndicator({ ...parts.slide(index).indicator })),
          ),
          CarouselNext({ ...parts.nextTrigger }),
        ]),
      ]
    },
  )

const chartAdapter: Adapter<ChartCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryChartScenario',
    () => {
      const initial = chart.init({
        series: [...CHART_FIXTURE_SERIES],
        rows: input.populated ? [...CHART_FIXTURE_ROWS] : [],
        label: input.label,
      })
      // Real `setActiveSeries` message — `dimmed` is a DERIVED consequence of
      // some other series being active, not a separate message (see the
      // baseline renderer's identical comment).
      return input.activeSeriesKey === null
        ? initial
        : chart.update(initial, { type: 'setActiveSeries', key: input.activeSeriesKey })[0]
    },
    chart.update,
    (state, send) => {
      const parts = chart.connect(state, send, { id: `registry-chart-${ctx.caseId}` })
      // Read the machine's OWN resolved label (post-init), not the raw
      // scenario input directly — otherwise a broken `chart.init({ label })`
      // wiring is invisible to the dimension-mutation test, since the title
      // text would still show the correct raw input regardless (#264 review
      // item 3).
      const resolvedLabel = state.peek().label
      return ChartContainer({ ...parts.root }, [
        ChartSvg({ ...parts.svg }, [
          ChartTitle({ ...parts.title }, [text(resolvedLabel)]),
          ChartDesc({ ...parts.desc }, [text('Six-series chart (three bar, three area)')]),
          chartForcedColorPatterns(`registry-chart-${ctx.caseId}`),
          ChartLayer({ ...parts.layer }, [
            each(parts.gridLines, {
              key: (line) => String(line.value),
              render: (line) => {
                const l = line.peek()
                return [ChartGrid({ ...parts.grid, d: l.d })]
              },
            }),
          ]),
          ChartLayer({ ...parts.layer }, [
            each(parts.marks, {
              key: (mark) => `${mark.seriesKey}:${mark.index ?? 'series'}`,
              render: (mark) => {
                const m = mark.peek()
                return [ChartMark({ ...parts.markProps(m) })]
              },
            }),
            each(parts.vertices, {
              key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
              render: (vertex) => {
                const v = vertex.peek()
                return [ChartDot({ ...parts.dotProps(v), r: 3 })]
              },
            }),
          ]),
          each(parts.categoryTicks, {
            key: (tick) => tick.label,
            render: (tick) => [ChartAxisLabel({ ...parts.axisLabel }, [text(tick.at('label'))])],
          }),
        ]),
        ChartTooltipContent({ ...parts.tooltip }, [text(parts.activeLabel)]),
        ChartLegend(
          CHART_FIXTURE_SERIES.map((series) =>
            ChartLegendItem({ ...parts.legendItem(series.key) }, [
              ChartLegendSwatch({ ...parts.legendSwatch(series.key) }),
              text(series.label),
            ]),
          ),
        ),
        ChartTable({ ...parts.table }, [
          ChartTableBody([
            ChartTableRow([ChartTableCell([text('Q1')]), ChartTableCell([text('12')])]),
          ]),
        ]),
      ])
    },
  )

const marqueeAdapter: Adapter<MarqueeCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryMarqueeScenario',
    () =>
      marquee.init({
        direction: input.direction,
        // Reduced motion means the scroll never starts (#264 item 2f/5).
        running: input.running && ctx.environment.motion !== 'reduced',
        disabled: input.disabled,
        pauseOnHover: true,
      }),
    marquee.update,
    (state, send) => {
      const parts = marquee.connect(state, send)
      return Marquee({ ...parts.root }, [MarqueeContent({ ...parts.content }, [text(input.label)])])
    },
  )

const meterAdapter: Adapter<MeterCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryMeterScenario',
    () =>
      meter.init({
        value: input.value,
        min: 0,
        max: 100,
        bands: [
          { id: 'optimal', to: 50, tone: 'optimal', label: 'Optimal' },
          { id: 'suboptimal', from: 50, to: 80, tone: 'suboptimal', label: 'Suboptimal' },
          { id: 'critical', from: 80, tone: 'critical', label: 'Critical' },
        ],
      }),
    meter.update,
    (state, send) => {
      void ctx
      const parts = meter.connect(state, send, { label: input.label })
      return Meter({ ...parts.root }, [
        MeterLabel({ ...parts.label }, [text(parts.valueText)]),
        MeterTrack({ ...parts.track }, [
          MeterBand({ ...parts.band('optimal') }),
          MeterBand({ ...parts.band('suboptimal') }),
          MeterBand({ ...parts.band('critical') }),
          MeterRange({ ...parts.range }),
          MeterMarker({ ...parts.marker }),
        ]),
      ])
    },
  )

const paginationAdapter: Adapter<PaginationCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryPaginationScenario',
    () =>
      pagination.init({
        page: input.page,
        total: input.total * 10,
        pageSize: 10,
        disabled: input.disabled,
      }),
    pagination.update,
    (state, send) => {
      const parts = pagination.connect(state, send, { id: `registry-pagination-${ctx.caseId}` })
      return [
        parts.directionSync,
        Pagination({ ...parts.root }, [
          PaginationContent([
            PaginationItem([PaginationPrevious({ ...parts.prevTrigger }, [text('Previous')])]),
            each(state.map(pagination.pageItems), {
              key: (item) =>
                item.type === 'page' ? `page-${item.page}` : `ellipsis-${item.position}`,
              render: (item) => {
                const value = item.peek()
                return value.type === 'page'
                  ? [
                      PaginationItem([
                        PaginationLink({ ...parts.item(value.page) }, [text(String(value.page))]),
                      ]),
                    ]
                  : [
                      PaginationItem([
                        PaginationEllipsis({ ...parts.ellipsis(value.position) }, [text('…')]),
                      ]),
                    ]
              },
            }),
            PaginationItem([PaginationNext({ ...parts.nextTrigger }, [text('Next')])]),
          ]),
        ]),
      ]
    },
  )

const progressAdapter: Adapter<ProgressCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryProgressScenario',
    () => progress.init({ value: input.value }),
    progress.update,
    (state, send) => {
      void ctx
      const parts = progress.connect(state, send, { label: input.label })
      return Progress({ ...parts.root }, [
        ProgressLabel({ ...parts.label }, [text(parts.valueText)]),
        ProgressTrack({ ...parts.track }, [ProgressRange({ ...parts.range })]),
      ])
    },
  )

const sparklineAdapter: Adapter<SparklineCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistrySparklineScenario',
    () =>
      sparkline.init({
        points: [...SPARKLINE_FIXTURE_POINTS],
        band: { ...SPARKLINE_FIXTURE_BAND },
        now:
          SPARKLINE_FIXTURE_POINTS[SPARKLINE_FIXTURE_POINTS.length - 1]!.at +
          input.nowOffsetDays * 24 * 60 * 60 * 1000,
      }),
    sparkline.update,
    (state, send) => {
      const parts = sparkline.connect(state, send, {
        id: `registry-sparkline-${ctx.caseId}`,
        label: input.label,
      })
      return Sparkline({ ...parts.root }, [
        SparklineSvg({ ...parts.svg }, [
          SparklineTitle({ ...parts.title }, [text(parts.label)]),
          SparklineDesc({ ...parts.desc }, [text('Trend over time')]),
          SparklineBand({ ...parts.band }),
          SparklineLayer({ ...parts.layer }, [
            each(parts.ticks, {
              key: (tick) => tick.key,
              render: (tick) => [SparklineGrid({ ...parts.tickProps(tick) })],
            }),
            each(parts.spans, {
              key: (candidate) => candidate.key,
              render: (candidate) => [SparklineSpan({ ...parts.spanProps(candidate) })],
            }),
          ]),
          SparklineNow({ ...parts.now }),
          SparklineLine({ ...parts.line }),
          SparklineLayer({ ...parts.layer }, [
            each(parts.dots, {
              key: (dot) => dot.key,
              render: (dot) => [SparklineDot({ ...parts.dotProps(dot), r: 2 })],
            }),
          ]),
        ]),
        SparklineTooltip({ ...parts.tooltip }, [
          text(parts.activeDot.map((dot) => dot?.value ?? '')),
        ]),
        SparklineTable({ ...parts.table }, [
          SparklineTableBody([
            SparklineTableRow([
              SparklineTableCell([text('2026-01-01')]),
              SparklineTableCell([text('4')]),
            ]),
          ]),
        ]),
      ])
    },
  )

const stepsAdapter: Adapter<StepsCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryStepsScenario',
    () => {
      const initial = steps.init({
        steps: ['Account', 'Configure', 'Review'],
        current: input.current,
        completed: [...input.completed],
        disabled: input.disabled,
      })
      return input.errorStep === null
        ? initial
        : steps.update(initial, { type: 'markError', step: input.errorStep })[0]
    },
    steps.update,
    (state, send) => {
      void ctx
      const parts = steps.connect(state, send)
      return Steps({ ...parts.root }, [
        ...[0, 1, 2].map((index) => {
          const item = parts.item(index)
          return StepsItem({ ...item.item }, [
            StepsTrigger({ ...item.trigger }, [text(String(index + 1))]),
            StepsSeparator({ ...item.separator }),
          ])
        }),
        button({ ...parts.prevTrigger }, [text('Previous')]),
        button({ ...parts.nextTrigger }, [text('Next')]),
      ])
    },
  )

// The glyph is ONE reactive text node driven by the part's own `data-state`
// Signal, never a hardcoded "✓" — a literal glyph renders "checked" for a row
// the machine reports as unchecked or indeterminate the moment selection
// changes (#264). Shared with the baseline renderer's identical need.
function tableCheckboxGlyph(
  dataState: Signal<'checked' | 'unchecked' | 'indeterminate'>,
): Mountable {
  return text(dataState.map((s) => (s === 'checked' ? '✓' : s === 'indeterminate' ? '−' : '')))
}

// `table.ts` tracks only sort STATE by design — its own doc says the
// consumer "performs the actual data sort ... by feeding pre-sorted `rows`
// back in" (see `examples/registry-demo/src/sections/data.ts`'s identical
// resort follow-up). Without this, `toggleSort` flips `aria-sort` on the
// header while every row stays in its original DOM position — the "gallery
// Table ignores sort" gap (#264). The fixture's one sortable column
// ('name') is the row id itself.
function resolveGalleryTableSort(state: table.TableState): table.TableState {
  const sort = state.sort
  if (sort === null || sort.columnId !== 'name') return state
  const sortedIds = [...state.rows].sort((a, b) =>
    sort.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a),
  )
  return table.update(state, { type: 'setRows', rows: sortedIds })[0]
}

function tableUpdateWithResort(
  state: table.TableState,
  msg: table.TableMsg,
): [table.TableState, never[]] {
  const [next] = table.update(state, msg)
  return [resolveGalleryTableSort(next), []]
}

// Rows are keyed over the machine's OWN row-id order (`state.at('rows')`) —
// the authoritative display order after a sort — rather than a fixed
// `ids.map`, and `index` is the live `Reactive<number>` a keyed `each` hands
// its `render`, never `.peek()`'d: a keyed row is REUSED (moved, not
// rebuilt) on reorder, so freezing the index at build time would leave
// `aria-rowindex`/`data-row-index` and the row's own checkbox dispatch stuck
// at their ORIGINAL position forever (#264).
function registryMachineTable(state: Signal<table.TableState>, parts: table.TableParts): Mountable {
  return Table({ ...parts.root, viewport: parts.viewport }, [
    TableHeader([
      TableRow([
        TableHead({ ...parts.columnHeader('name') }, [
          (() => {
            const selectAll = parts.selectAllCheckbox('name')
            return span({ ...selectAll }, [tableCheckboxGlyph(selectAll['data-state'])])
          })(),
          text('Name'),
        ]),
        TableHead({ ...parts.columnHeader('status') }, [text('Status')]),
      ]),
    ]),
    TableBody([
      each(state.at('rows'), {
        key: (id) => id,
        render: (idSignal, index) => {
          const id = idSignal.peek()
          const rowCheckbox = parts.rowCheckbox(id, index)
          return [
            TableRow({ ...parts.row(id, index) }, [
              TableCell({ ...parts.cell(index, 0) }, [
                span({ ...rowCheckbox }, [tableCheckboxGlyph(rowCheckbox['data-state'])]),
                text(id),
              ]),
              TableCell({ ...parts.cell(index, 1) }, [text('Ready')]),
            ]),
          ]
        },
      }),
    ]),
  ])
}

const tableAdapter: Adapter<TableCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryTableScenario',
    () =>
      table.init({
        columns: [...TABLE_FIXTURE_COLUMNS],
        rows: [...input.rows],
        selectionMode: 'multiple',
        selection: [...input.selection],
        sort:
          input.sortColumnId === null
            ? undefined
            : { columnId: input.sortColumnId, direction: 'asc' },
        disabled: input.disabled,
      }),
    tableUpdateWithResort,
    (state, send) =>
      registryMachineTable(
        state,
        table.connect(state, send, { id: `registry-table-${ctx.caseId}`, density: input.density }),
      ),
  )

const tabsAdapter: Adapter<TabsCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryTabsScenario',
    () =>
      tabs.init({
        items: ['summary', 'details'],
        value: input.value,
        orientation: input.orientation,
        disabledItems: [...input.disabledItems],
      }),
    tabs.update,
    (state, send) => {
      const parts = tabs.connect(state, send, { id: `registry-tabs-${ctx.caseId}` })
      return [
        parts.directionSync,
        Tabs({ ...parts.root }, [
          TabsList({ ...parts.list }, [
            TabsTrigger({ ...parts.item('summary').trigger }, [text('Summary')]),
            TabsTrigger({ ...parts.item('details').trigger }, [text('Details')]),
            span({ ...parts.indicator }),
          ]),
          TabsContent({ ...parts.item('summary').panel }, [text('Summary panel')]),
          TabsContent({ ...parts.item('details').panel }, [text('Details panel')]),
        ]),
      ]
    },
  )

const tocAdapter: Adapter<TocCaseInput> = (host, input, ctx) => {
  const entries = [
    { id: 'overview', label: 'Overview', level: 1 },
    { id: 'api', label: 'API', level: 2 },
  ]
  return mountMachine(
    host,
    ctx,
    'RegistryTocScenario',
    () => toc.init({ items: entries, activeId: input.activeId, expanded: [...input.expanded] }),
    toc.update,
    (state, send) => {
      void ctx
      const parts = toc.connect(state, send)
      return Toc({ ...parts.root }, [
        TocList(
          { ...parts.list },
          entries.map((entry) => {
            const item = parts.item(entry)
            return TocItem({ ...item.item }, [
              TocExpandTrigger({ ...item.expandTrigger }, [text('›')]),
              TocLink({ ...item.link }, [text(entry.label)]),
            ])
          }),
        ),
      ])
    },
  )
}

const treeViewAdapter: Adapter<TreeViewCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryTreeViewScenario',
    () => {
      let initial = treeView.init({
        visibleItems: ['src', 'index'],
        expanded: [...input.expanded],
        selected: [...input.selected],
        selectionMode: 'checkbox',
        disabled: input.disabled,
      })
      initial = treeView.update(initial, { type: 'focus', id: 'src' })[0]
      return input.busy ? treeView.update(initial, { type: 'loadingStart', id: 'src' })[0] : initial
    },
    treeView.update,
    (state, send) => {
      const parts = treeView.connect(state, send, { id: `registry-tree-${ctx.caseId}` })
      const branch = parts.item('src', 0, true)
      const leaf = parts.item('index', 1, false, 'src')
      return TreeView({ ...parts.root }, [
        TreeViewItem({ ...branch.item }, [
          TreeViewBranchTrigger({ ...branch.branchTrigger }, [text('›')]),
          TreeViewCheckbox({ ...branch.checkbox }, [text('✓')]),
          text('src'),
        ]),
        TreeViewItem({ ...leaf.item }, [
          TreeViewCheckbox({ ...leaf.checkbox }, [text('✓')]),
          text('index.ts'),
        ]),
      ])
    },
  )

const dataTableAdapter: Adapter<DataTableCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryDataTableScenario',
    () => {
      const initial = dataTable.init({
        columns: [...TABLE_FIXTURE_COLUMNS],
        selectionMode: 'multiple',
        pageSize: 2,
      })
      if (input.phase === 'loading') return dataTable.update(initial, { type: 'reload' })[0]
      if (input.phase === 'error') {
        const pending = dataTable.update(initial, { type: 'reload' })[0]
        return dataTable.update(pending, {
          type: 'pageFailed',
          queryId: pending.queryId,
          error: 'Could not load',
        })[0]
      }
      return dataTable.update(initial, {
        type: 'pageLoaded',
        queryId: initial.queryId,
        rows: [...input.rows],
        total: input.rows.length,
      })[0]
    },
    dataTable.update,
    (state, send) => {
      const parts = dataTable.connect(state, send, {
        id: `registry-data-table-${ctx.caseId}`,
        density: input.density,
      })
      return div([
        parts.pagination.directionSync,
        registryMachineTable(state.at('table'), parts.table),
        DataTableLoadingOverlay({ ...parts.loadingOverlay }, [text('Loading')]),
        DataTableEmptyState({ ...parts.emptyState }, [
          DataTableEmptyTitle([text('Empty')]),
          DataTableEmptyDescription([text('No rows')]),
        ]),
        DataTableErrorState({ ...parts.errorState }, [text('Error')]),
        Pagination({ ...parts.pagination.root }, [
          PaginationContent([
            PaginationItem([PaginationPrevious({ ...parts.pagination.prevTrigger })]),
            PaginationItem([PaginationLink({ ...parts.pagination.item(1) }, [text('1')])]),
            PaginationItem([PaginationEllipsis({ ...parts.pagination.ellipsis('end') })]),
            PaginationItem([PaginationNext({ ...parts.pagination.nextTrigger })]),
          ]),
        ]),
      ])
    },
  )

function staticAdapter<Input>(render: (input: Input) => Mountable): Adapter<Input> {
  return (host, input, ctx) => {
    applyEnvironmentAttrs(host, ctx.environment)
    return mountApp(
      host,
      component<null, never, never>({
        name: `RegistryStatic${ctx.caseId}`,
        init: () => [null, []],
        update: (state) => [state, []],
        view: () => [render(input)],
      }),
    )
  }
}

const chipAdapter: Adapter<ChipCaseInput> = staticAdapter((input) =>
  Chip({ value: input.label, ...(input.hue === null ? {} : { hue: input.hue }) }),
)
const alertAdapter: Adapter<AlertCaseInput> = staticAdapter((input) =>
  Alert({ variant: input.variant }, [
    AlertTitle([text(input.title)]),
    AlertDescription([text(input.description)]),
  ]),
)
const badgeAdapter: Adapter<BadgeCaseInput> = staticAdapter((input) =>
  Badge({ variant: input.variant }, [text(input.label)]),
)
const cardAdapter: Adapter<CardCaseInput> = staticAdapter((input) =>
  Card([
    CardHeader([
      CardTitle([text(input.title)]),
      CardDescription([text(input.description)]),
      ...(input.actionLabel === null ? [] : [CardAction([text(input.actionLabel)])]),
    ]),
    CardContent(
      input.sections.length === 0
        ? [text('Content')]
        : input.sections.map((section) => text(section)),
    ),
  ]),
)
const emptyAdapter: Adapter<EmptyCaseInput> = staticAdapter((input) =>
  Empty([
    EmptyHeader([EmptyTitle([text(input.title)]), EmptyDescription([text(input.description)])]),
    EmptyContent([text(input.actionLabel ?? '')]),
  ]),
)
const itemAdapter: Adapter<ItemCaseInput> = staticAdapter((input) =>
  Item(
    {
      variant: input.variant,
      size: input.density === 'compact' ? 'sm' : 'default',
    },
    [ItemContent([ItemTitle([text(input.title)]), ItemDescription([text(input.description)])])],
  ),
)
const kbdAdapter: Adapter<KbdCaseInput> = staticAdapter((input) =>
  KbdGroup(input.keys.map((key) => Kbd([text(key)]))),
)
const separatorAdapter: Adapter<SeparatorCaseInput> = staticAdapter((input) =>
  Separator({ orientation: input.orientation, decorative: input.decorative }),
)
const skeletonAdapter: Adapter<BusyCaseInput> = staticAdapter((input) =>
  Skeleton({ 'aria-label': input.label }),
)
const spinnerAdapter: Adapter<BusyCaseInput> = staticAdapter((input) =>
  Spinner({ 'aria-label': input.label }),
)
const typographyAdapter: Adapter<TypographyCaseInput> = staticAdapter((input) =>
  div([
    TypographyH2([text(input.title || 'Typography')]),
    TypographyP([text(input.text || 'Body copy')]),
    TypographyInlineCode([text(input.code || 'code')]),
    TypographyBlockquote([text('Quotation')]),
    TypographyList([TypographyListItem([text('List item')])]),
    TypographyPre([text(input.code || 'preformatted')]),
  ]),
)
const sidebarAdapter: Adapter<SidebarCaseInput> = staticAdapter((input) =>
  SidebarProvider([
    Sidebar({ 'data-state': input.state }, [
      SidebarGap(),
      SidebarContainer([
        SidebarInner([
          SidebarHeader([text(input.label)]),
          SidebarContent([
            SidebarMenu([
              SidebarMenuItem([
                SidebarMenuButton({ size: input.density === 'compact' ? 'sm' : 'default' }, [
                  text(input.current),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
    SidebarMobile([text('Mobile navigation')]),
    SidebarInset([text('Content')]),
  ]),
)

/** Adapters for all 29 navigation-data products (unlike the baseline
 * renderer, the registryTailwind path covers every scenario, including the
 * 11 registry-only presentational atoms). Kept SEPARATE from
 * `NAVIGATION_DATA_DEFINITIONS`'s case data per the protocol's own rule. */
export const REGISTRY_ADAPTERS = {
  'component:accordion': accordionAdapter,
  'component:avatar': avatarAdapter,
  'component:breadcrumbs': breadcrumbsAdapter,
  'component:carousel': carouselAdapter,
  'component:chart': chartAdapter,
  'component:collapsible': collapsibleAdapter,
  'component:marquee': marqueeAdapter,
  'component:meter': meterAdapter,
  'component:pagination': paginationAdapter,
  'component:progress': progressAdapter,
  'component:sparkline': sparklineAdapter,
  'component:steps': stepsAdapter,
  'component:table': tableAdapter,
  'component:tabs': tabsAdapter,
  'component:toc': tocAdapter,
  'component:tree-view': treeViewAdapter,
  'pattern:data-table': dataTableAdapter,
  'registry:chip': chipAdapter,
  'registry:alert': alertAdapter,
  'registry:badge': badgeAdapter,
  'registry:card': cardAdapter,
  'registry:empty': emptyAdapter,
  'registry:item': itemAdapter,
  'registry:kbd': kbdAdapter,
  'registry:separator': separatorAdapter,
  'registry:skeleton': skeletonAdapter,
  'registry:spinner': spinnerAdapter,
  'registry:typography': typographyAdapter,
  'registry:sidebar': sidebarAdapter,
} as const satisfies Record<NavigationDataScenarioId, Adapter<never>>

function renderResolvedRegistry(
  host: HTMLElement,
  scenarioId: string,
  caseId: string,
  input: unknown,
  environment: PresentationScenarioEnvironment,
): Disposable {
  const adapter = REGISTRY_ADAPTERS[scenarioId as keyof typeof REGISTRY_ADAPTERS]
  if (adapter === undefined) {
    throw new Error(`No registry adapter registered for navigation-data scenario ${scenarioId}`)
  }
  return (adapter as Adapter<unknown>)(host, input, {
    scenarioId: scenarioId as NavigationDataScenarioId,
    caseId,
    environment,
  })
}

function assertBindings(scenarios: readonly NavigationDataJoinedScenario[]): void {
  const scenarioIds = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bindingIds = Object.keys(REGISTRY_ADAPTERS).sort()
  if (JSON.stringify(scenarioIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Registry navigation/data renderer bindings do not match applicable ProductContract scenarios: expected ${scenarioIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountRegistryNavigationDataScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: NavigationDataCatalog,
  scenarios: readonly NavigationDataJoinedScenario[] = applicableNavigationDataScenarios(
    joinNavigationDataScenarios(catalog, contract),
    'registryTailwind',
  ),
): Disposable {
  assertBindings(scenarios)
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    for (const scenarioCase of scenario.cases) {
      const resolved = resolveScenarioSelection<NavigationDataDefinitions>(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'registryTailwind',
      })
      const host = document.createElement('section')
      host.id = `registry-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'registryTailwind'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(
        renderResolvedRegistry(
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
