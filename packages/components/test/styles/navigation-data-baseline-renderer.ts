import {
  a,
  button,
  circle,
  component,
  div,
  each,
  g,
  img,
  li,
  mountApp,
  nav,
  ol,
  path,
  section,
  span,
  svg,
  svgDesc,
  svgTitle,
  table as tableElement,
  tbody,
  td,
  text,
  th,
  thead,
  tr,
  type Mountable,
  type ReadSignal,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import {
  dispatchScenarioSelection,
  resolveScenarioSelection,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import * as accordion from '../../src/components/accordion'
import * as avatar from '../../src/components/avatar'
import * as breadcrumbs from '../../src/components/breadcrumbs'
import * as carousel from '../../src/components/carousel'
import * as chart from '../../src/components/chart'
import { chartForcedColorPatterns } from '../../src/components/chart'
import * as collapsible from '../../src/components/collapsible'
import * as marquee from '../../src/components/marquee'
import * as meter from '../../src/components/meter'
import * as pagination from '../../src/components/pagination'
import * as progress from '../../src/components/progress'
import * as sparkline from '../../src/components/sparkline'
import * as steps from '../../src/components/steps'
import * as table from '../../src/components/table'
import * as tabs from '../../src/components/tabs'
import * as toc from '../../src/components/toc'
import * as treeView from '../../src/components/tree-view'
import * as dataTable from '../../src/patterns/data-table'
import {
  applicableNavigationDataScenarios,
  joinNavigationDataScenarios,
  CHART_FIXTURE_ROWS,
  CHART_FIXTURE_SERIES,
  SPARKLINE_FIXTURE_BAND,
  SPARKLINE_FIXTURE_POINTS,
  TABLE_FIXTURE_COLUMNS,
  type AvatarCaseInput,
  type BreadcrumbsCaseInput,
  type CarouselCaseInput,
  type ChartCaseInput,
  type DisclosureCaseInput,
  type MarqueeCaseInput,
  type MeterCaseInput,
  type NavigationDataCatalog,
  type NavigationDataDefinitions,
  type NavigationDataJoinedScenario,
  type NavigationDataScenarioId,
  type PaginationCaseInput,
  type ProgressCaseInput,
  type SparklineCaseInput,
  type StepsCaseInput,
  type TableCaseInput,
  type TabsCaseInput,
  type TocCaseInput,
  type DataTableCaseInput,
  type TreeViewCaseInput,
  type ChipCaseInput,
} from './navigation-data-scenarios'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: NavigationDataScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

/** An adapter renders ONE typed, product-specific input through the real
 * machine -> connect -> baseline skin. It never reads case/environment data
 * beyond what `RenderContext` states, so a dimension-mutation test can call
 * it directly with a hand-mutated `input` and observe the same real output a
 * resolved selection would have produced. */
export type Adapter<Input> = (host: HTMLElement, input: Input, ctx: RenderContext) => Disposable

/**
 * Applies the resolved environment to the case's own mount host, the same way
 * a real app propagates it down from an ancestor (`<html dir>`,
 * `[data-theme]`) rather than baking one axis value per case (#264 item
 * D/5/2f — a dimension-mutation test that always resolves against `{}` never
 * exercises these axes at all, and no adapter previously read `ctx.environment`
 * regardless of what was passed). `dir`/`data-theme`/`data-viewport`/
 * `data-forced-colors` are UNIVERSAL: every product's markup materially
 * differs by exactly this attribute regardless of whether its own CSS reacts
 * to it, so no allowance is needed for those four axes. `motion` is NOT
 * universal — only `animated`-capable machines (accordion/collapsible) have
 * anything to gate on it; every other product's own dimension-mutation
 * allowance table documents that honestly instead of inventing an effect.
 */
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

/** Drives the REAL accordion reducer to the requested disclosure phase,
 * including `closing` (#264 item C): `AccordionState.closing` is entered by
 * opening the item with `animated: true` and then sending `close` — a real
 * reducer transition, not a fabricated init value, so it is observable in
 * jsdom with no animation timing involved. */
/** `animated` follows the resolved `motion` axis (#264 item 2f/5): reduced
 * motion means no retained exit phase to animate, so the reducer transitions
 * straight to fully closed rather than passing through `closing` — a real,
 * observable difference the dimension-mutation test now exercises. The
 * dedicated closing-phase test never overrides motion, so it stays on the
 * default `full` and keeps seeing the retained `closing` phase. */
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
  if (input.state === 'closing') {
    // A real reducer transition into `closing` only retains when the
    // message carries `retain: true` (#264 review-264j) — a real trigger
    // click stamps this from the runtime registry, so this fixture stamps
    // it directly, exactly like a real click would produce.
    return accordion.update(opened, { type: 'close', value: itemValue, retain: true })[0]
  }
  return accordion.init({ items: [itemValue], value: [], disabled: input.disabled, animated })
}

function initDisclosureCollapsible(
  input: DisclosureCaseInput,
  environment: PresentationScenarioEnvironment,
): collapsible.CollapsibleState {
  const animated = environment.motion !== 'reduced'
  const opened = collapsible.init({ open: true, disabled: input.disabled, animated })
  if (input.state === 'open') return opened
  if (input.state === 'closing') {
    // See the identical note in `initDisclosureAccordion` (#264 review-264j).
    return collapsible.update(opened, { type: 'close', retain: true })[0]
  }
  return collapsible.init({ open: false, disabled: input.disabled, animated })
}

const accordionAdapter: Adapter<DisclosureCaseInput> = (host, input, ctx) => {
  const itemValue = 'item'
  return mountMachine(
    host,
    ctx,
    'BaselineAccordionScenario',
    () => initDisclosureAccordion(itemValue, input, ctx.environment),
    accordion.update,
    (state, send) => {
      const parts = accordion.connect(state, send, { id: `baseline-accordion-${ctx.caseId}` })
      const item = parts.item(itemValue)
      // `exitCompletion` is placed for realism, matching a real mount
      // exactly (#264 review-264j): "is a watcher mounted" now lives in a
      // runtime registry keyed by `opts.id`, never in state, so the
      // `closing` phase this scenario constructs via a direct reducer call
      // (`initDisclosureAccordion`, stamping `retain: true` directly) needs
      // no attach/detach message of any kind to line up with it — placing
      // this part is simply what a real consumer does, so this fixture
      // renders the shape a live instance actually produces.
      return [
        div({ ...parts.root }, [
          div({ ...item.item }, [
            button({ ...item.trigger }, [text(input.label)]),
            div({ ...item.content }, [text(input.content)]),
          ]),
        ]),
        parts.exitCompletion,
      ]
    },
  )
}

const collapsibleAdapter: Adapter<DisclosureCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineCollapsibleScenario',
    () => initDisclosureCollapsible(input, ctx.environment),
    collapsible.update,
    (state, send) => {
      const parts = collapsible.connect(state, send, { id: `baseline-collapsible-${ctx.caseId}` })
      // See accordionAdapter's identical note above.
      return [
        div({ ...parts.root }, [
          button({ ...parts.trigger }, [text(input.label)]),
          div({ ...parts.content }, [text(input.content)]),
        ]),
        parts.exitCompletion,
      ]
    },
  )

const avatarAdapter: Adapter<AvatarCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineAvatarScenario',
    () => ({ ...avatar.init(), status: input.status }),
    avatar.update,
    (state, send) => {
      void ctx
      const parts = avatar.connect(state, send, { alt: input.label, density: input.density })
      return div({ ...parts.root }, [
        img({ ...parts.image, src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
        span({ ...parts.fallback }, [text(input.initials)]),
      ])
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
    'BaselineBreadcrumbsScenario',
    () => breadcrumbs.init({ items, maxVisible: input.maxVisible }),
    breadcrumbs.update,
    (state, send) => {
      void ctx
      const parts = breadcrumbs.connect(state, send)
      // Driven from the real `visibleItems(state)` projection — NOT a
      // hardcoded [home, current, ellipsis] shape — so `maxVisible`
      // genuinely gates whether the ellipsis renders at all (#264 item D).
      return nav({ ...parts.root }, [
        ol({ ...parts.list }, [
          each(state.map(breadcrumbs.visibleItems), {
            key: (entry) => (entry.type === 'ellipsis' ? 'ellipsis' : entry.id),
            render: (entry, index) => {
              const value = entry.peek()
              const separator = index.peek() > 0 ? [li({ ...parts.separator }, [text('/')])] : []
              if (value.type === 'ellipsis') {
                return [...separator, li([button({ ...parts.ellipsisTrigger }, [text('…')])])]
              }
              return [
                ...separator,
                li({ ...parts.item(value.id) }, [
                  a({ ...parts.link(value.id), href: `#${value.id}` }, [text(value.label)]),
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
    'BaselineCarouselScenario',
    () => carousel.init({ count: input.count, current: input.index, loop: input.loop }),
    carousel.update,
    (state, send) => {
      const parts = carousel.connect(state, send, { id: `baseline-carousel-${ctx.caseId}` })
      const slides = Array.from({ length: input.count }, (_, index) => index)
      return section({ ...parts.root }, [
        parts.directionSync,
        div({ ...parts.viewport }, [
          div(
            { ...parts.track },
            slides.map((index) =>
              div({ ...parts.slide(index).slide }, [text(`Slide ${index + 1}`)]),
            ),
          ),
        ]),
        button({ ...parts.prevTrigger }, [text('Previous')]),
        div(
          { ...parts.indicatorGroup },
          slides.map((index) => button({ ...parts.slide(index).indicator }, [])),
        ),
        button({ ...parts.nextTrigger }, [text('Next')]),
      ])
    },
  )

const chartAdapter: Adapter<ChartCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineChartScenario',
    () => {
      const initial = chart.init({
        series: [...CHART_FIXTURE_SERIES],
        rows: input.populated ? [...CHART_FIXTURE_ROWS] : [],
        label: input.label,
      })
      // Real `setActiveSeries` message, not a fabricated dim/toggle one — a
      // series is only ever "dimmed" as a DERIVED consequence of some OTHER
      // series being active (`geometryOf` in chart.ts computes `dimmed` from
      // `activeSeries`; there is no separate dim message).
      return input.activeSeriesKey === null
        ? initial
        : chart.update(initial, { type: 'setActiveSeries', key: input.activeSeriesKey })[0]
    },
    chart.update,
    (state, send) => {
      const parts = chart.connect(state, send, { id: `baseline-chart-${ctx.caseId}` })
      // Read the machine's OWN resolved label (post-init), not the raw
      // scenario input directly — otherwise a broken `chart.init({ label })`
      // wiring is invisible to the dimension-mutation test, since the title
      // text would still show the correct raw input regardless (#264 review
      // item 3).
      const resolvedLabel = state.peek().label
      return section({ ...parts.root }, [
        svg({ ...parts.svg }, [
          svgTitle({ ...parts.title }, [text(resolvedLabel)]),
          svgDesc({ ...parts.desc }, [text('Six-series chart (three bar, three area)')]),
          chartForcedColorPatterns(`baseline-chart-${ctx.caseId}`),
          g({ ...parts.layer }, [
            each(parts.gridLines, {
              key: (line) => String(line.value),
              render: (line) => {
                const l = line.peek()
                return [path({ ...parts.grid, d: l.d })]
              },
            }),
          ]),
          g({ ...parts.layer }, [
            each(parts.marks, {
              key: (mark) => `${mark.seriesKey}:${mark.index ?? 'series'}`,
              render: (mark) => {
                const m = mark.peek()
                return [path({ ...parts.markProps(m) })]
              },
            }),
            each(parts.vertices, {
              key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
              render: (vertex) => {
                const v = vertex.peek()
                return [circle({ ...parts.dotProps(v), r: 3 })]
              },
            }),
          ]),
          each(parts.categoryTicks, {
            key: (tick) => tick.label,
            render: (tick) => [span({ ...parts.axisLabel }, [text(tick.at('label'))])],
          }),
        ]),
        div({ ...parts.tooltip }, [text(parts.activeLabel)]),
        div(
          CHART_FIXTURE_SERIES.map((series) =>
            button({ ...parts.legendItem(series.key) }, [
              span({ ...parts.legendSwatch(series.key) }),
              text(series.label),
            ]),
          ),
        ),
        tableElement({ ...parts.table }, [tbody([tr([td([text('Q1')]), td([text('12')])])])]),
      ])
    },
  )

const marqueeAdapter: Adapter<MarqueeCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineMarqueeScenario',
    () =>
      marquee.init({
        direction: input.direction,
        // A continuously-running marquee is exactly the WCAG 2.3.3 case
        // reduced motion exists for: reduced means the scroll never starts,
        // not merely a faster/instant version of it (#264 item 2f/5).
        running: input.running && ctx.environment.motion !== 'reduced',
        disabled: input.disabled,
        pauseOnHover: true,
      }),
    marquee.update,
    (state, send) => {
      const parts = marquee.connect(state, send)
      return div({ ...parts.root }, [div({ ...parts.content }, [text(input.label)])])
    },
  )

const meterAdapter: Adapter<MeterCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineMeterScenario',
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
      return div({ ...parts.root }, [
        span({ ...parts.label }, [text(parts.valueText)]),
        div({ ...parts.track }, [
          div({ ...parts.band('optimal') }),
          div({ ...parts.band('suboptimal') }),
          div({ ...parts.band('critical') }),
          div({ ...parts.range }),
          div({ ...parts.marker }),
        ]),
      ])
    },
  )

const paginationAdapter: Adapter<PaginationCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselinePaginationScenario',
    () =>
      pagination.init({
        page: input.page,
        total: input.total * 10,
        pageSize: 10,
        disabled: input.disabled,
      }),
    pagination.update,
    (state, send) => {
      const parts = pagination.connect(state, send, { id: `baseline-pagination-${ctx.caseId}` })
      // Driven from the real `pageItems(state)` projection — NOT a hardcoded
      // [1, …, 2, …] shape — so `total`/`page` genuinely change which page
      // buttons and ellipses render (#264 item D).
      return [
        parts.directionSync,
        nav({ ...parts.root }, [
          button({ ...parts.prevTrigger }, [text('Previous')]),
          each(state.map(pagination.pageItems), {
            key: (item) =>
              item.type === 'page' ? `page-${item.page}` : `ellipsis-${item.position}`,
            render: (item) => {
              const value = item.peek()
              return value.type === 'page'
                ? [button({ ...parts.item(value.page) }, [text(String(value.page))])]
                : [span({ ...parts.ellipsis(value.position) }, [text('…')])]
            },
          }),
          button({ ...parts.nextTrigger }, [text('Next')]),
        ]),
      ]
    },
  )

const progressAdapter: Adapter<ProgressCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineProgressScenario',
    () => progress.init({ value: input.value }),
    progress.update,
    (state, send) => {
      void ctx
      const parts = progress.connect(state, send, { label: input.label })
      return div({ ...parts.root }, [
        span({ ...parts.label }, [text(parts.valueText)]),
        div({ ...parts.track }, [div({ ...parts.range })]),
      ])
    },
  )

const sparklineAdapter: Adapter<SparklineCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineSparklineScenario',
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
        id: `baseline-sparkline-${ctx.caseId}`,
        label: input.label,
      })
      return div({ ...parts.root }, [
        svg({ ...parts.svg }, [
          svgTitle({ ...parts.title }, [text(parts.label)]),
          svgDesc({ ...parts.desc }, [text('Trend over time')]),
          path({ ...parts.band }),
          g({ ...parts.layer }, [
            each(parts.ticks, {
              key: (tick) => tick.key,
              render: (tick) => [path({ ...parts.tickProps(tick) })],
            }),
            each(parts.spans, {
              key: (candidate) => candidate.key,
              render: (candidate) => [path({ ...parts.spanProps(candidate) })],
            }),
          ]),
          path({ ...parts.now }),
          path({ ...parts.line }),
          g({ ...parts.layer }, [
            each(parts.dots, {
              key: (dot) => dot.key,
              render: (dot) => [circle({ ...parts.dotProps(dot), r: 2 })],
            }),
          ]),
        ]),
        div({ ...parts.tooltip }, [text(parts.activeDot.map((dot) => dot?.value ?? ''))]),
        tableElement({ ...parts.table }, [
          tbody([tr([td([text('2026-01-01')]), td([text('4')])])]),
        ]),
      ])
    },
  )

const stepsAdapter: Adapter<StepsCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineStepsScenario',
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
      return div({ ...parts.root }, [
        ...[0, 1, 2].map((index) => {
          const item = parts.item(index)
          return div({ ...item.item }, [
            button({ ...item.trigger }, [text(String(index + 1))]),
            span({ ...item.separator }),
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
// changes (#264). Shared shape with the registry renderer's identical need.
function tableCheckboxGlyph(
  dataState: ReadSignal<'checked' | 'unchecked' | 'indeterminate'>,
): Mountable {
  return text(dataState.map((s) => (s === 'checked' ? '✓' : s === 'indeterminate' ? '−' : '')))
}

// `table.ts` tracks only sort STATE by design — its own doc says the
// consumer "performs the actual data sort ... by feeding pre-sorted `rows`
// back in" (see the Baseline composition
// `examples/baseline-css/src/test-fixtures/compositions/navigation-data.ts`'s
// identical `resolveTableSort`). Without this follow-up, `toggleSort` flips
// `aria-sort` on the header while every row stays in its original DOM
// position — exactly the "gallery Table ignores sort" gap (#264). The
// fixture's one sortable column ('name') is the row id itself.
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

const tableAdapter: Adapter<TableCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineTableScenario',
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
    (state, send) => {
      const parts = table.connect(state, send, {
        id: `baseline-table-${ctx.caseId}`,
        density: input.density,
      })
      return div({ ...parts.viewport }, [
        tableElement({ ...parts.root }, [
          thead([
            tr([
              th({ ...parts.columnHeader('name') }, [
                (() => {
                  const selectAll = parts.selectAllCheckbox('name')
                  return span({ ...selectAll }, [tableCheckboxGlyph(selectAll['data-state'])])
                })(),
                text('Name'),
              ]),
              th({ ...parts.columnHeader('status') }, [text('Status')]),
            ]),
          ]),
          tbody([
            // Rows are keyed over the machine's OWN row-id order
            // (`state.at('rows')`) — the authoritative display order after a
            // sort — rather than a fixed `input.rows.map`, and `index` is the
            // live `Reactive<number>` a keyed `each` hands its `render`,
            // never `.peek()`'d: a keyed row is REUSED (moved, not rebuilt)
            // on reorder, so freezing the index at build time would leave
            // `aria-rowindex`/`data-row-index` and the row's own checkbox
            // dispatch stuck at their ORIGINAL position forever (#264).
            each(state.at('rows'), {
              key: (id) => id,
              render: (idSignal, index) => {
                const id = idSignal.peek()
                const rowCheckbox = parts.rowCheckbox(id, index)
                return [
                  tr({ ...parts.row(id, index) }, [
                    td({ ...parts.cell(index, 0) }, [
                      span({ ...rowCheckbox }, [tableCheckboxGlyph(rowCheckbox['data-state'])]),
                      text(id),
                    ]),
                    td({ ...parts.cell(index, 1) }, [text('Ready')]),
                  ]),
                ]
              },
            }),
          ]),
        ]),
      ])
    },
  )

const tabsAdapter: Adapter<TabsCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineTabsScenario',
    () =>
      tabs.init({
        items: ['summary', 'details'],
        value: input.value,
        orientation: input.orientation,
        disabledItems: [...input.disabledItems],
      }),
    tabs.update,
    (state, send) => {
      const parts = tabs.connect(state, send, { id: `baseline-tabs-${ctx.caseId}` })
      return [
        parts.directionSync,
        div({ ...parts.root }, [
          div({ ...parts.list }, [
            button({ ...parts.item('summary').trigger }, [text('Summary')]),
            button({ ...parts.item('details').trigger }, [text('Details')]),
            span({ ...parts.indicator }),
          ]),
          div({ ...parts.item('summary').panel }, [text('Summary panel')]),
          div({ ...parts.item('details').panel }, [text('Details panel')]),
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
    'BaselineTocScenario',
    () => toc.init({ items: entries, activeId: input.activeId, expanded: [...input.expanded] }),
    toc.update,
    (state, send) => {
      void ctx
      const parts = toc.connect(state, send)
      return nav({ ...parts.root }, [
        ol(
          { ...parts.list },
          entries.map((entry) => {
            const item = parts.item(entry)
            return li({ ...item.item }, [
              button({ ...item.expandTrigger }, [text('›')]),
              a({ ...item.link }, [text(entry.label)]),
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
    'BaselineTreeViewScenario',
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
      const parts = treeView.connect(state, send, { id: `baseline-tree-${ctx.caseId}` })
      const branch = parts.item('src', 0, true)
      const leaf = parts.item('index', 1, false, 'src')
      return div({ ...parts.root }, [
        div({ ...branch.item }, [
          button({ ...branch.branchTrigger }, [text('›')]),
          span({ ...branch.checkbox }, [text('✓')]),
          text('src'),
        ]),
        div({ ...leaf.item }, [span({ ...leaf.checkbox }, [text('✓')]), text('index.ts')]),
      ])
    },
  )

const dataTableAdapter: Adapter<DataTableCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineDataTableScenario',
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
        id: `baseline-data-table-${ctx.caseId}`,
        density: input.density,
      })
      return section([
        parts.pagination.directionSync,
        div({ ...parts.table.viewport }, [
          tableElement({ ...parts.table.root }, [
            thead([
              tr([
                th({ ...parts.table.columnHeader('name') }, [
                  (() => {
                    const selectAll = parts.table.selectAllCheckbox('name')
                    return span({ ...selectAll }, [tableCheckboxGlyph(selectAll['data-state'])])
                  })(),
                  text('Name'),
                ]),
                th({ ...parts.table.columnHeader('status') }, [text('Status')]),
              ]),
            ]),
            tbody([
              // Same reactive-index/live-order requirement as the plain
              // table adapter above (#264) — the data-table pattern wraps
              // the SAME table machine, so its rows keyed over
              // `state.at('table.rows')` reorder on sort exactly like it.
              each(state.at('table.rows'), {
                key: (id) => id,
                render: (idSignal, index) => {
                  const id = idSignal.peek()
                  const rowCheckbox = parts.table.rowCheckbox(id, index)
                  return [
                    tr({ ...parts.table.row(id, index) }, [
                      td({ ...parts.table.cell(index, 0) }, [
                        span({ ...rowCheckbox }, [tableCheckboxGlyph(rowCheckbox['data-state'])]),
                        text(id),
                      ]),
                      td({ ...parts.table.cell(index, 1) }, [text('Ready')]),
                    ]),
                  ]
                },
              }),
            ]),
          ]),
        ]),
        div({ ...parts.loadingOverlay }, [text('Loading')]),
        div({ ...parts.emptyState }, [text('Empty')]),
        div({ ...parts.errorState }, [text('Error')]),
        nav({ ...parts.pagination.root }, [
          button({ ...parts.pagination.prevTrigger }, [text('Previous')]),
          button({ ...parts.pagination.item(1) }, [text('1')]),
          span({ ...parts.pagination.ellipsis('end') }, [text('…')]),
          button({ ...parts.pagination.nextTrigger }, [text('Next')]),
        ]),
      ])
    },
  )

const chipAdapter: Adapter<ChipCaseInput> = (host, input, ctx) => {
  applyEnvironmentAttrs(host, ctx.environment)
  const element = document.createElement('span')
  element.dataset.scope = 'chip'
  element.dataset.part = 'chip'
  element.textContent = input.label
  if (input.hue !== null) element.style.setProperty('--chip-hue', String(input.hue))
  host.append(element)
  return { dispose: () => element.remove() }
}

/** Adapters for every product with a baseline presentation (18 of 29 — the 11
 * registry-only atoms are `not-applicable` on this path and never resolved
 * here; see `resolveScenarioSelection`'s own `invalid-path` guard). Keyed by
 * `scenarioId`, kept SEPARATE from `NAVIGATION_DATA_DEFINITIONS`'s case data
 * per the protocol's own "renderer adapters live in each app as separate
 * maps" rule. */
export const BASELINE_ADAPTERS = {
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
} as const satisfies Partial<Record<NavigationDataScenarioId, Adapter<never>>>

function assertBindings(scenarios: readonly NavigationDataJoinedScenario[]): void {
  const scenarioIds = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bindingIds = Object.keys(BASELINE_ADAPTERS).sort()
  if (JSON.stringify(scenarioIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Baseline navigation/data renderer bindings do not match applicable ProductContract scenarios: expected ${scenarioIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountBaselineNavigationDataScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: NavigationDataCatalog,
  scenarios: readonly NavigationDataJoinedScenario[] = applicableNavigationDataScenarios(
    joinNavigationDataScenarios(catalog, contract),
    'baseline',
  ),
): Disposable {
  assertBindings(scenarios)
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    for (const scenarioCase of scenario.cases) {
      const resolved = resolveScenarioSelection<NavigationDataDefinitions>(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'baseline',
      })
      const host = document.createElement('section')
      host.id = `baseline-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'baseline'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(dispatchScenarioSelection(catalog, BASELINE_ADAPTERS, resolved, host, {}))
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
    },
  }
}
