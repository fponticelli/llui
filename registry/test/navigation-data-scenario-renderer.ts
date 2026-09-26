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
import type {
  JsonObject,
  NavigationDataScenario,
  NavigationDataScenarioCase,
} from '../../packages/components/test/styles/navigation-data-scenarios'

interface Disposable {
  dispose(): void
}

type Adapter = (
  host: HTMLElement,
  scenario: NavigationDataScenario,
  scenarioCase: NavigationDataScenarioCase,
) => Disposable

const stringValue = (input: Readonly<JsonObject>, key: string, fallback: string): string =>
  typeof input[key] === 'string' ? input[key] : fallback
const numberValue = (input: Readonly<JsonObject>, key: string, fallback: number): number =>
  typeof input[key] === 'number' ? input[key] : fallback
const boolValue = (input: Readonly<JsonObject>, key: string): boolean => input[key] === true

function mountMachine<S, M extends { type: string }, E extends { type: string } = never>(
  host: HTMLElement,
  name: string,
  initial: () => S,
  update: (state: S, msg: M) => [S, E[]],
  view: (state: Signal<S>, send: Send<M>) => Mountable | readonly Mountable[],
): Disposable {
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

const accordionAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const input = scenarioCase.input
  return mountMachine(
    host,
    'RegistryAccordionScenario',
    () =>
      accordion.init({
        items: ['item'],
        value: stringValue(input, 'state', 'closed') === 'open' ? ['item'] : [],
        disabled: boolValue(input, 'disabled'),
        animated: true,
      }),
    accordion.update,
    (state, send) => {
      const parts = accordion.connect(state, send, { id: `registry-accordion-${scenarioCase.id}` })
      const item = parts.item('item')
      return Accordion({ ...parts.root }, [
        AccordionItem({ ...item.item }, [
          AccordionTrigger({ ...item.trigger }, [text(stringValue(input, 'label', 'Disclosure'))]),
          AccordionContent({ ...item.content }, [
            text(stringValue(input, 'content', 'Disclosure content')),
          ]),
        ]),
      ])
    },
  )
}

const avatarAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const status = stringValue(scenarioCase.input, 'state', 'fallback')
  const density = stringValue(scenarioCase.input, 'density', 'comfortable')
  return mountMachine(
    host,
    'RegistryAvatarScenario',
    () => ({
      ...avatar.init(),
      status:
        status === 'loaded'
          ? ('loaded' as const)
          : status === 'loading'
            ? ('loading' as const)
            : ('error' as const),
    }),
    avatar.update,
    (state, send) => {
      const parts = avatar.connect(state, send, {
        alt: stringValue(scenarioCase.input, 'imageAlt', 'Avatar'),
        density: density === 'compact' ? 'compact' : 'comfortable',
      })
      return Avatar(
        {
          ...parts.root,
          'data-size': density === 'compact' ? 'sm' : 'default',
        },
        [
          AvatarImage({ ...parts.image, src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
          AvatarFallback({ ...parts.fallback }, [
            text(stringValue(scenarioCase.input, 'initials', 'LL')),
          ]),
        ],
      )
    },
  )
}

const breadcrumbsAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const items = [
    { id: 'home', label: 'Home' },
    { id: 'current', label: stringValue(scenarioCase.input, 'label', 'Current') },
  ]
  return mountMachine(
    host,
    'RegistryBreadcrumbScenario',
    () => breadcrumbs.init({ items, maxVisible: scenarioCase.id === 'collapsed' ? 1 : 4 }),
    breadcrumbs.update,
    (state, send) => {
      const parts = breadcrumbs.connect(state, send)
      return Breadcrumb({ ...parts.root }, [
        BreadcrumbList({ ...parts.list }, [
          BreadcrumbItem({ ...parts.item('home') }, [
            BreadcrumbLink({ ...parts.link('home'), href: '#home' }, [text('Home')]),
          ]),
          BreadcrumbSeparator({ ...parts.separator }),
          BreadcrumbItem({ ...parts.item('current') }, [
            BreadcrumbLink({ ...parts.link('current'), href: '#current' }, [text(items[1]!.label)]),
          ]),
          BreadcrumbItem([BreadcrumbEllipsis({ ...parts.ellipsisTrigger }, [text('…')])]),
        ]),
      ])
    },
  )
}

const carouselAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryCarouselScenario',
    () =>
      carousel.init({
        count: 3,
        current: numberValue(scenarioCase.input, 'index', 0),
        loop: true,
      }),
    carousel.update,
    (state, send) => {
      const parts = carousel.connect(state, send, { id: `registry-carousel-${scenarioCase.id}` })
      return [
        parts.directionSync,
        Carousel({ ...parts.root }, [
          CarouselViewport({ ...parts.viewport }, [
            CarouselContent(
              { ...parts.track },
              [0, 1, 2].map((index) =>
                CarouselSlide({ ...parts.slide(index).slide }, [text(`Slide ${index + 1}`)]),
              ),
            ),
          ]),
          CarouselPrevious({ ...parts.prevTrigger }),
          CarouselIndicatorGroup(
            { ...parts.indicatorGroup },
            [0, 1, 2].map((index) => CarouselIndicator({ ...parts.slide(index).indicator })),
          ),
          CarouselNext({ ...parts.nextTrigger }),
        ]),
      ]
    },
  )

// THREE bar and THREE area series (#264): the redundant forced-colors cue
// (a fill pattern per data-series-cue) only proves anything with enough
// same-mark series that a flat `fill: CanvasText` would make them identical.
const chartSeries = [
  { key: 'bar1', label: 'Bar A', mark: 'bar' as const },
  { key: 'bar2', label: 'Bar B', mark: 'bar' as const },
  { key: 'bar3', label: 'Bar C', mark: 'bar' as const },
  { key: 'area1', label: 'Area A', mark: 'area' as const },
  { key: 'area2', label: 'Area B', mark: 'area' as const },
  { key: 'area3', label: 'Area C', mark: 'area' as const },
]
const chartRows: chart.ChartRow[] = [
  { label: 'Q1', values: { bar1: 12, bar2: 9, bar3: 6, area1: 14, area2: 10, area3: 7 } },
  { label: 'Q2', values: { bar1: 18, bar2: 13, bar3: 8, area1: 20, area2: 15, area3: 9 } },
]

const chartAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryChartScenario',
    () =>
      chart.init({
        series: chartSeries,
        rows: scenarioCase.id === 'empty' ? [] : chartRows,
        label: stringValue(scenarioCase.input, 'label', 'Chart'),
      }),
    chart.update,
    (state, send) => {
      const parts = chart.connect(state, send, { id: `registry-chart-${scenarioCase.id}` })
      return ChartContainer({ ...parts.root }, [
        ChartSvg({ ...parts.svg }, [
          ChartTitle({ ...parts.title }, [text(stringValue(scenarioCase.input, 'label', 'Chart'))]),
          ChartDesc({ ...parts.desc }, [text('Six-series chart (three bar, three area)')]),
          chartForcedColorPatterns(),
          ChartLayer({ ...parts.layer }, [
            each(parts.gridLines, {
              key: (line) => String(line.value),
              render: (line) => [ChartGrid({ ...parts.grid, d: line.peek().d })],
            }),
          ]),
          ChartLayer({ ...parts.layer }, [
            each(parts.marks, {
              key: (mark) => `${mark.seriesKey}:${mark.index ?? 'series'}`,
              render: (mark) => [ChartMark({ ...parts.markProps(mark.peek()) })],
            }),
            each(parts.vertices, {
              key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
              render: (vertex) => [ChartDot({ ...parts.dotProps(vertex.peek()), r: 3 })],
            }),
          ]),
          each(parts.categoryTicks, {
            key: (tick) => tick.label,
            render: (tick) => [ChartAxisLabel({ ...parts.axisLabel }, [text(tick.at('label'))])],
          }),
        ]),
        ChartTooltipContent({ ...parts.tooltip }, [text(parts.activeLabel)]),
        ChartLegend(
          chartSeries.map((series) =>
            ChartLegendItem({ ...parts.legendItem(series.key) }, [text(series.label)]),
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

const collapsibleAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryCollapsibleScenario',
    () =>
      collapsible.init({
        open: stringValue(scenarioCase.input, 'state', 'closed') === 'open',
        disabled: boolValue(scenarioCase.input, 'disabled'),
        animated: true,
      }),
    collapsible.update,
    (state, send) => {
      const parts = collapsible.connect(state, send, {
        id: `registry-collapsible-${scenarioCase.id}`,
      })
      return Collapsible({ ...parts.root }, [
        CollapsibleTrigger({ ...parts.trigger }, [
          text(stringValue(scenarioCase.input, 'label', 'Details')),
        ]),
        CollapsibleContent({ ...parts.content }, [
          text(stringValue(scenarioCase.input, 'content', 'Content')),
        ]),
      ])
    },
  )

const marqueeAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryMarqueeScenario',
    () =>
      marquee.init({
        direction: scenarioCase.id === 'vertical' ? 'down' : 'left',
        running: !boolValue(scenarioCase.input, 'paused'),
        disabled: boolValue(scenarioCase.input, 'disabled'),
        pauseOnHover: true,
      }),
    marquee.update,
    (state, send) => {
      const parts = marquee.connect(state, send)
      return Marquee({ ...parts.root }, [
        MarqueeContent({ ...parts.content }, [text('Alpha · Beta · Alpha · Beta')]),
      ])
    },
  )

const meterAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryMeterScenario',
    () =>
      meter.init({
        value: numberValue(scenarioCase.input, 'value', 42),
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
      const parts = meter.connect(state, send, {
        label: stringValue(scenarioCase.input, 'label', 'Meter'),
      })
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

const paginationAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryPaginationScenario',
    () =>
      pagination.init({
        page: numberValue(scenarioCase.input, 'page', 1),
        total: numberValue(scenarioCase.input, 'count', 10) * 10,
        pageSize: 10,
        disabled: boolValue(scenarioCase.input, 'disabled'),
      }),
    pagination.update,
    (state, send) => {
      const parts = pagination.connect(state, send, {
        id: `registry-pagination-${scenarioCase.id}`,
      })
      return [
        parts.directionSync,
        Pagination({ ...parts.root }, [
          PaginationContent([
            PaginationItem([PaginationPrevious({ ...parts.prevTrigger }, [text('Previous')])]),
            PaginationItem([PaginationLink({ ...parts.item(1) }, [text('1')])]),
            PaginationItem([PaginationEllipsis({ ...parts.ellipsis('start') }, [text('…')])]),
            PaginationItem([PaginationLink({ ...parts.item(2) }, [text('2')])]),
            PaginationItem([PaginationEllipsis({ ...parts.ellipsis('end') }, [text('…')])]),
            PaginationItem([PaginationNext({ ...parts.nextTrigger }, [text('Next')])]),
          ]),
        ]),
      ]
    },
  )

const progressAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryProgressScenario',
    () =>
      progress.init({
        value:
          scenarioCase.id === 'indeterminate' ? null : numberValue(scenarioCase.input, 'value', 60),
      }),
    progress.update,
    (state, send) => {
      const parts = progress.connect(state, send, {
        label: stringValue(scenarioCase.input, 'label', 'Progress'),
      })
      return Progress({ ...parts.root }, [
        ProgressLabel({ ...parts.label }, [text(parts.valueText)]),
        ProgressTrack({ ...parts.track }, [ProgressRange({ ...parts.range })]),
      ])
    },
  )

const sparkPoints = [
  { at: Date.UTC(2026, 0, 1), value: 4, grain: 'daily' },
  { at: Date.UTC(2026, 0, 2), value: 9, grain: 'daily' },
  { at: Date.UTC(2026, 0, 3), value: 6, grain: 'weekly' },
  { at: Date.UTC(2026, 0, 4), value: 12, grain: 'weekly' },
]

const sparklineAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistrySparklineScenario',
    () =>
      sparkline.init({
        points: sparkPoints,
        band: { low: 5, high: 10 },
        now: Date.UTC(2026, 0, 5),
      }),
    sparkline.update,
    (state, send) => {
      const parts = sparkline.connect(state, send, {
        id: `registry-sparkline-${scenarioCase.id}`,
        label: stringValue(scenarioCase.input, 'label', 'Trend'),
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

const stepsAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryStepsScenario',
    () => {
      const initial = steps.init({
        steps: ['Account', 'Configure', 'Review'],
        current: scenarioCase.id === 'pending' ? 0 : 1,
        completed: scenarioCase.id === 'completed' ? [0] : [],
        disabled: boolValue(scenarioCase.input, 'disabled'),
      })
      return scenarioCase.id === 'error'
        ? steps.update(initial, { type: 'markError', step: 1 })[0]
        : initial
    },
    steps.update,
    (state, send) => {
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

function registryMachineTable(parts: table.TableParts, ids: readonly string[]): Mountable {
  return Table({ viewport: parts.viewport, ...parts.root }, [
    TableHeader([
      TableRow([
        TableHead({ ...parts.columnHeader('name') }, [
          span({ ...parts.selectAllCheckbox('name') }, [text('✓')]),
          text('Name'),
        ]),
        TableHead({ ...parts.columnHeader('status') }, [text('Status')]),
      ]),
    ]),
    TableBody(
      ids.map((id, rowIndex) =>
        TableRow({ ...parts.row(id, rowIndex) }, [
          TableCell({ ...parts.cell(rowIndex, 0) }, [
            span({ ...parts.rowCheckbox(id, rowIndex) }, [text('✓')]),
            text(id),
          ]),
          TableCell({ ...parts.cell(rowIndex, 1) }, [text('Ready')]),
        ]),
      ),
    ),
  ])
}

const tableAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const ids = scenarioCase.id === 'empty' ? [] : ['alpha', 'beta']
  const density = stringValue(scenarioCase.input, 'density', 'comfortable')
  return mountMachine(
    host,
    'RegistryTableScenario',
    () =>
      table.init({
        columns: [
          { id: 'name', sortable: true },
          { id: 'status', sortable: true },
        ],
        rows: ids,
        selectionMode: 'multiple',
        selection: boolValue(scenarioCase.input, 'selected') ? ['alpha'] : [],
        disabled: boolValue(scenarioCase.input, 'disabled'),
      }),
    table.update,
    (state, send) =>
      registryMachineTable(
        table.connect(state, send, {
          id: `registry-table-${scenarioCase.id}`,
          density: density === 'compact' ? 'compact' : 'comfortable',
        }),
        ids,
      ),
  )
}

const tabsAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryTabsScenario',
    () =>
      tabs.init({
        items: ['summary', 'details'],
        value: scenarioCase.id === 'inactive' ? 'details' : 'summary',
        orientation: scenarioCase.id === 'vertical' ? 'vertical' : 'horizontal',
        disabledItems: boolValue(scenarioCase.input, 'disabled') ? ['summary'] : [],
      }),
    tabs.update,
    (state, send) => {
      const parts = tabs.connect(state, send, { id: `registry-tabs-${scenarioCase.id}` })
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

const tocAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const entries = [
    { id: 'overview', label: 'Overview', level: 1 },
    { id: 'api', label: 'API', level: 2 },
  ]
  return mountMachine(
    host,
    'RegistryTocScenario',
    () =>
      toc.init({
        items: entries,
        activeId: scenarioCase.id === 'current' ? 'api' : 'overview',
        expanded: scenarioCase.id === 'expanded' ? ['api'] : [],
      }),
    toc.update,
    (state, send) => {
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

const treeViewAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'RegistryTreeViewScenario',
    () => {
      let initial = treeView.init({
        visibleItems: ['src', 'index'],
        expanded: boolValue(scenarioCase.input, 'expanded') ? ['src'] : [],
        selected: boolValue(scenarioCase.input, 'selected') ? ['index'] : [],
        selectionMode: 'checkbox',
        disabled: boolValue(scenarioCase.input, 'disabled'),
      })
      initial = treeView.update(initial, { type: 'focus', id: 'src' })[0]
      return boolValue(scenarioCase.input, 'busy')
        ? treeView.update(initial, { type: 'loadingStart', id: 'src' })[0]
        : initial
    },
    treeView.update,
    (state, send) => {
      const parts = treeView.connect(state, send, { id: `registry-tree-${scenarioCase.id}` })
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

const dataTableAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const ids = scenarioCase.id === 'empty' ? [] : ['alpha', 'beta']
  const density = stringValue(scenarioCase.input, 'density', 'comfortable')
  return mountMachine(
    host,
    'RegistryDataTableScenario',
    () => {
      const initial = dataTable.init({
        columns: [
          { id: 'name', sortable: true },
          { id: 'status', sortable: true },
        ],
        selectionMode: 'multiple',
        pageSize: 2,
      })
      if (scenarioCase.id === 'loading') return dataTable.update(initial, { type: 'reload' })[0]
      if (scenarioCase.id === 'error') {
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
        rows: ids,
        total: ids.length,
      })[0]
    },
    dataTable.update,
    (state, send) => {
      const parts = dataTable.connect(state, send, {
        id: `registry-data-table-${scenarioCase.id}`,
        density: density === 'compact' ? 'compact' : 'comfortable',
      })
      return div({ 'data-density': density }, [
        parts.pagination.directionSync,
        registryMachineTable(parts.table, ids),
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
}

function staticAdapter(render: (scenarioCase: NavigationDataScenarioCase) => Mountable): Adapter {
  return (host, _scenario, scenarioCase) => {
    const handle = mountApp(
      host,
      component<null, never, never>({
        name: `RegistryStatic${scenarioCase.id}`,
        init: () => [null, []],
        update: (state) => [state, []],
        view: () => [render(scenarioCase)],
      }),
    )
    return handle
  }
}

const alertAdapter = staticAdapter(({ input }) =>
  Alert({ variant: boolValue(input, 'error') ? 'destructive' : 'default' }, [
    AlertTitle([text(stringValue(input, 'title', 'Alert'))]),
    AlertDescription([text(stringValue(input, 'description', 'Description'))]),
  ]),
)
const badgeAdapter = staticAdapter(({ input }) =>
  Badge({ variant: stringValue(input, 'state', 'default') as 'default' }, [
    text(stringValue(input, 'label', 'Badge')),
  ]),
)
const cardAdapter = staticAdapter(({ input }) =>
  Card([
    CardHeader([
      CardTitle([text(stringValue(input, 'title', 'Card'))]),
      CardDescription([text(stringValue(input, 'description', 'Description'))]),
      CardAction([text(stringValue(input, 'actionLabel', 'Open'))]),
    ]),
    CardContent([text('Content')]),
  ]),
)
const chipAdapter = staticAdapter(({ input }) =>
  Chip({
    value: stringValue(input, 'label', 'Chip'),
    ...(typeof input.hue === 'number' ? { hue: input.hue } : {}),
  }),
)
const emptyAdapter = staticAdapter(({ input }) =>
  Empty([
    EmptyHeader([
      EmptyTitle([text(stringValue(input, 'title', 'Empty'))]),
      EmptyDescription([text(stringValue(input, 'description', 'No results'))]),
    ]),
    EmptyContent([text(stringValue(input, 'actionLabel', 'Add item'))]),
  ]),
)
const itemAdapter = staticAdapter(({ input }) => {
  const density = stringValue(input, 'density', 'comfortable')
  return Item({ size: density === 'compact' ? 'sm' : 'default', 'data-density': density }, [
    ItemContent([
      ItemTitle([text(stringValue(input, 'title', 'Item'))]),
      ItemDescription([text(stringValue(input, 'description', 'Description'))]),
    ]),
  ])
})
const kbdAdapter = staticAdapter(({ input }) => {
  const keys = Array.isArray(input.keys)
    ? input.keys.filter((key): key is string => typeof key === 'string')
    : ['K']
  return KbdGroup(keys.map((key) => Kbd([text(key)])))
})
const separatorAdapter = staticAdapter(({ input }) =>
  Separator({
    orientation: stringValue(input, 'orientation', 'horizontal') as 'horizontal' | 'vertical',
    decorative: input.decorative !== false,
  }),
)
const skeletonAdapter = staticAdapter(() => Skeleton({ 'aria-label': 'Loading content' }))
const spinnerAdapter = staticAdapter(({ input }) =>
  Spinner({ 'aria-label': stringValue(input, 'label', 'Loading') }),
)
const typographyAdapter = staticAdapter(({ input }) =>
  div([
    TypographyH2([text(stringValue(input, 'title', 'Typography'))]),
    TypographyP([text(stringValue(input, 'text', 'Body copy'))]),
    TypographyInlineCode([text(stringValue(input, 'code', 'code'))]),
    TypographyBlockquote([text('Quotation')]),
    TypographyList([TypographyListItem([text('List item')])]),
    TypographyPre([text(stringValue(input, 'code', 'preformatted'))]),
  ]),
)
const sidebarAdapter = staticAdapter(({ input }) => {
  const density = stringValue(input, 'density', 'comfortable')
  return SidebarProvider({ 'data-density': density }, [
    Sidebar({ 'data-state': stringValue(input, 'state', 'expanded') }, [
      SidebarGap(),
      SidebarContainer([
        SidebarInner([
          SidebarHeader([text(stringValue(input, 'label', 'Workspace'))]),
          SidebarContent([
            SidebarMenu([
              SidebarMenuItem([
                SidebarMenuButton({ size: density === 'compact' ? 'sm' : 'default' }, [
                  text('Overview'),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
    SidebarMobile([text('Mobile navigation')]),
    SidebarInset([text('Content')]),
  ])
})

const adapters = {
  accordion: accordionAdapter,
  alert: alertAdapter,
  avatar: avatarAdapter,
  badge: badgeAdapter,
  breadcrumbs: breadcrumbsAdapter,
  card: cardAdapter,
  carousel: carouselAdapter,
  chart: chartAdapter,
  chip: chipAdapter,
  collapsible: collapsibleAdapter,
  'data-table': dataTableAdapter,
  empty: emptyAdapter,
  item: itemAdapter,
  kbd: kbdAdapter,
  marquee: marqueeAdapter,
  meter: meterAdapter,
  pagination: paginationAdapter,
  progress: progressAdapter,
  separator: separatorAdapter,
  sidebar: sidebarAdapter,
  skeleton: skeletonAdapter,
  sparkline: sparklineAdapter,
  spinner: spinnerAdapter,
  steps: stepsAdapter,
  table: tableAdapter,
  tabs: tabsAdapter,
  toc: tocAdapter,
  'tree-view': treeViewAdapter,
  typography: typographyAdapter,
} as const satisfies Record<string, Adapter>

function assertBindings(scenarios: readonly NavigationDataScenario[]): void {
  const productIds = scenarios.map(({ productId }) => productId).sort()
  const bindingIds = Object.keys(adapters).sort()
  if (JSON.stringify(productIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Registry navigation/data renderer bindings do not match applicable ProductContract products: expected ${productIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountRegistryNavigationDataScenarios(
  container: HTMLElement,
  scenarios: readonly NavigationDataScenario[],
): Disposable {
  assertBindings(scenarios)
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    const adapter = adapters[scenario.productId as keyof typeof adapters]
    for (const scenarioCase of scenario.cases) {
      const host = document.createElement('section')
      host.id = `registry-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'registryTailwind'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(adapter(host, scenario, scenarioCase))
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
    },
  }
}
