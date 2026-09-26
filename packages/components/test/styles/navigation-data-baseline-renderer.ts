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
  type Send,
  type Signal,
} from '@llui/dom'
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
import type {
  JsonObject,
  JsonValue,
  NavigationDataScenario,
  NavigationDataScenarioCase,
} from './navigation-data-scenarios'

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
  const { input } = scenarioCase
  const itemValue = 'item'
  return mountMachine(
    host,
    'BaselineAccordionScenario',
    () =>
      accordion.init({
        items: [itemValue],
        value: stringValue(input, 'state', 'closed') === 'open' ? [itemValue] : [],
        disabled: boolValue(input, 'disabled'),
        animated: true,
      }),
    accordion.update,
    (state, send) => {
      const parts = accordion.connect(state, send, {
        id: `baseline-accordion-${scenarioCase.id}`,
      })
      const item = parts.item(itemValue)
      return div({ ...parts.root }, [
        div({ ...item.item }, [
          button({ ...item.trigger }, [text(stringValue(input, 'label', 'Disclosure'))]),
          div({ ...item.content }, [text(stringValue(input, 'content', 'Disclosure content'))]),
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
    'BaselineAvatarScenario',
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
      return div({ ...parts.root }, [
        img({ ...parts.image, src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
        span({ ...parts.fallback }, [text(stringValue(scenarioCase.input, 'initials', 'LL'))]),
      ])
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
    'BaselineBreadcrumbsScenario',
    () => breadcrumbs.init({ items, maxVisible: scenarioCase.id === 'collapsed' ? 1 : 4 }),
    breadcrumbs.update,
    (state, send) => {
      const parts = breadcrumbs.connect(state, send)
      return nav({ ...parts.root }, [
        ol({ ...parts.list }, [
          li({ ...parts.item('home') }, [
            a({ ...parts.link('home'), href: '#home' }, [text('Home')]),
          ]),
          li({ ...parts.separator }, [text('/')]),
          li({ ...parts.item('current') }, [
            a({ ...parts.link('current'), href: '#current' }, [text(items[1]!.label)]),
          ]),
          li([button({ ...parts.ellipsisTrigger }, [text('…')])]),
        ]),
      ])
    },
  )
}

const carouselAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const current = numberValue(scenarioCase.input, 'index', 0)
  return mountMachine(
    host,
    'BaselineCarouselScenario',
    () => carousel.init({ count: 3, current, loop: true }),
    carousel.update,
    (state, send) => {
      const parts = carousel.connect(state, send, {
        id: `baseline-carousel-${scenarioCase.id}`,
      })
      return section({ ...parts.root }, [
        parts.directionSync,
        div({ ...parts.viewport }, [
          div(
            { ...parts.track },
            [0, 1, 2].map((index) =>
              div({ ...parts.slide(index).slide }, [text(`Slide ${index + 1}`)]),
            ),
          ),
        ]),
        button({ ...parts.prevTrigger }, [text('Previous')]),
        div(
          { ...parts.indicatorGroup },
          [0, 1, 2].map((index) => button({ ...parts.slide(index).indicator }, [])),
        ),
        button({ ...parts.nextTrigger }, [text('Next')]),
      ])
    },
  )
}

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
    'BaselineChartScenario',
    () =>
      chart.init({
        series: chartSeries,
        rows: scenarioCase.id === 'empty' ? [] : chartRows,
        label: stringValue(scenarioCase.input, 'label', 'Chart'),
      }),
    chart.update,
    (state, send) => {
      const parts = chart.connect(state, send, { id: `baseline-chart-${scenarioCase.id}` })
      return section({ ...parts.root }, [
        svg({ ...parts.svg }, [
          svgTitle({ ...parts.title }, [text(stringValue(scenarioCase.input, 'label', 'Chart'))]),
          svgDesc({ ...parts.desc }, [text('Six-series chart (three bar, three area)')]),
          chartForcedColorPatterns(),
          g({ ...parts.layer }, [
            each(parts.gridLines, {
              key: (line) => String(line.value),
              render: (line) => [path({ ...parts.grid, d: line.peek().d })],
            }),
          ]),
          g({ ...parts.layer }, [
            each(parts.marks, {
              key: (mark) => `${mark.seriesKey}:${mark.index ?? 'series'}`,
              render: (mark) => [path({ ...parts.markProps(mark.peek()) })],
            }),
            each(parts.vertices, {
              key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
              render: (vertex) => [circle({ ...parts.dotProps(vertex.peek()), r: 3 })],
            }),
          ]),
          each(parts.categoryTicks, {
            key: (tick) => tick.label,
            render: (tick) => [span({ ...parts.axisLabel }, [text(tick.at('label'))])],
          }),
        ]),
        div({ ...parts.tooltip }, [text(parts.activeLabel)]),
        div(
          chartSeries.map((series) =>
            button({ ...parts.legendItem(series.key) }, [text(series.label)]),
          ),
        ),
        tableElement({ ...parts.table }, [tbody([tr([td([text('Q1')]), td([text('12')])])])]),
      ])
    },
  )

const collapsibleAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselineCollapsibleScenario',
    () =>
      collapsible.init({
        open: stringValue(scenarioCase.input, 'state', 'closed') === 'open',
        disabled: boolValue(scenarioCase.input, 'disabled'),
        animated: true,
      }),
    collapsible.update,
    (state, send) => {
      const parts = collapsible.connect(state, send, {
        id: `baseline-collapsible-${scenarioCase.id}`,
      })
      return div({ ...parts.root }, [
        button({ ...parts.trigger }, [text(stringValue(scenarioCase.input, 'label', 'Details'))]),
        div({ ...parts.content }, [text(stringValue(scenarioCase.input, 'content', 'Content'))]),
      ])
    },
  )

const marqueeAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const direction = scenarioCase.id === 'vertical' ? ('down' as const) : ('left' as const)
  return mountMachine(
    host,
    'BaselineMarqueeScenario',
    () =>
      marquee.init({
        direction,
        running: !boolValue(scenarioCase.input, 'paused'),
        disabled: boolValue(scenarioCase.input, 'disabled'),
        pauseOnHover: true,
      }),
    marquee.update,
    (state, send) => {
      const parts = marquee.connect(state, send)
      return div({ ...parts.root }, [
        div({ ...parts.content }, [text('Alpha · Beta · Alpha · Beta')]),
      ])
    },
  )
}

const meterAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselineMeterScenario',
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

const paginationAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselinePaginationScenario',
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
        id: `baseline-pagination-${scenarioCase.id}`,
      })
      return [
        parts.directionSync,
        nav({ ...parts.root }, [
          button({ ...parts.prevTrigger }, [text('Previous')]),
          button({ ...parts.item(1) }, [text('1')]),
          span({ ...parts.ellipsis('start') }, [text('…')]),
          button({ ...parts.item(2) }, [text('2')]),
          span({ ...parts.ellipsis('end') }, [text('…')]),
          button({ ...parts.nextTrigger }, [text('Next')]),
        ]),
      ]
    },
  )

const progressAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselineProgressScenario',
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
      return div({ ...parts.root }, [
        span({ ...parts.label }, [text(parts.valueText)]),
        div({ ...parts.track }, [div({ ...parts.range })]),
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
    'BaselineSparklineScenario',
    () =>
      sparkline.init({
        points: sparkPoints,
        band: { low: 5, high: 10 },
        now: Date.UTC(2026, 0, 5),
      }),
    sparkline.update,
    (state, send) => {
      const parts = sparkline.connect(state, send, {
        id: `baseline-sparkline-${scenarioCase.id}`,
        label: stringValue(scenarioCase.input, 'label', 'Trend'),
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

const stepsAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselineStepsScenario',
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

const tableAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const rows = scenarioCase.id === 'empty' ? [] : ['alpha', 'beta']
  const density = stringValue(scenarioCase.input, 'density', 'comfortable')
  return mountMachine(
    host,
    'BaselineTableScenario',
    () =>
      table.init({
        columns: [
          { id: 'name', sortable: true },
          { id: 'status', sortable: true },
        ],
        rows,
        selectionMode: 'multiple',
        selection: boolValue(scenarioCase.input, 'selected') ? ['alpha'] : [],
        disabled: boolValue(scenarioCase.input, 'disabled'),
      }),
    table.update,
    (state, send) => {
      const parts = table.connect(state, send, {
        id: `baseline-table-${scenarioCase.id}`,
        density: density === 'compact' ? 'compact' : 'comfortable',
      })
      return div({ ...parts.viewport }, [
        tableElement({ ...parts.root }, [
          thead([
            tr([
              th({ ...parts.columnHeader('name') }, [
                span({ ...parts.selectAllCheckbox('name') }, [text('✓')]),
                text('Name'),
              ]),
              th({ ...parts.columnHeader('status') }, [text('Status')]),
            ]),
          ]),
          tbody(
            rows.map((id, rowIndex) =>
              tr({ ...parts.row(id, rowIndex) }, [
                td({ ...parts.cell(rowIndex, 0) }, [
                  span({ ...parts.rowCheckbox(id, rowIndex) }, [text('✓')]),
                  text(id),
                ]),
                td({ ...parts.cell(rowIndex, 1) }, [text('Ready')]),
              ]),
            ),
          ),
        ]),
      ])
    },
  )
}

const tabsAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const active = scenarioCase.id === 'inactive' ? 'details' : 'summary'
  return mountMachine(
    host,
    'BaselineTabsScenario',
    () =>
      tabs.init({
        items: ['summary', 'details'],
        value: active,
        orientation: scenarioCase.id === 'vertical' ? 'vertical' : 'horizontal',
        disabledItems: boolValue(scenarioCase.input, 'disabled') ? ['summary'] : [],
      }),
    tabs.update,
    (state, send) => {
      const parts = tabs.connect(state, send, { id: `baseline-tabs-${scenarioCase.id}` })
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
}

const tocAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const entries = [
    { id: 'overview', label: 'Overview', level: 1 },
    { id: 'api', label: 'API', level: 2 },
  ]
  return mountMachine(
    host,
    'BaselineTocScenario',
    () =>
      toc.init({
        items: entries,
        activeId: scenarioCase.id === 'current' ? 'api' : 'overview',
        expanded: scenarioCase.id === 'expanded' ? ['api'] : [],
      }),
    toc.update,
    (state, send) => {
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

const treeViewAdapter: Adapter = (host, _scenario, scenarioCase) =>
  mountMachine(
    host,
    'BaselineTreeViewScenario',
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
      const parts = treeView.connect(state, send, { id: `baseline-tree-${scenarioCase.id}` })
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

const dataTableAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const ids = scenarioCase.id === 'empty' ? [] : ['alpha', 'beta']
  const density = stringValue(scenarioCase.input, 'density', 'comfortable')
  return mountMachine(
    host,
    'BaselineDataTableScenario',
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
        id: `baseline-data-table-${scenarioCase.id}`,
        density: density === 'compact' ? 'compact' : 'comfortable',
      })
      return section({ 'data-density': density }, [
        parts.pagination.directionSync,
        div({ ...parts.table.viewport }, [
          tableElement({ ...parts.table.root }, [
            thead([
              tr([
                th({ ...parts.table.columnHeader('name') }, [
                  span({ ...parts.table.selectAllCheckbox('name') }, [text('✓')]),
                  text('Name'),
                ]),
                th({ ...parts.table.columnHeader('status') }, [text('Status')]),
              ]),
            ]),
            tbody(
              ids.map((id, rowIndex) =>
                tr({ ...parts.table.row(id, rowIndex) }, [
                  td({ ...parts.table.cell(rowIndex, 0) }, [
                    span({ ...parts.table.rowCheckbox(id, rowIndex) }, [text('✓')]),
                    text(id),
                  ]),
                  td({ ...parts.table.cell(rowIndex, 1) }, [text('Ready')]),
                ]),
              ),
            ),
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
}

const chipAdapter: Adapter = (host, _scenario, scenarioCase) => {
  const element = document.createElement('span')
  element.dataset.scope = 'chip'
  element.dataset.part = 'chip'
  element.textContent = stringValue(scenarioCase.input, 'label', 'Chip')
  if (typeof scenarioCase.input.hue === 'number') {
    element.style.setProperty('--chip-hue', String(scenarioCase.input.hue))
  }
  host.append(element)
  return { dispose: () => element.remove() }
}

const adapters = {
  accordion: accordionAdapter,
  avatar: avatarAdapter,
  breadcrumbs: breadcrumbsAdapter,
  carousel: carouselAdapter,
  chart: chartAdapter,
  chip: chipAdapter,
  collapsible: collapsibleAdapter,
  'data-table': dataTableAdapter,
  marquee: marqueeAdapter,
  meter: meterAdapter,
  pagination: paginationAdapter,
  progress: progressAdapter,
  sparkline: sparklineAdapter,
  steps: stepsAdapter,
  table: tableAdapter,
  tabs: tabsAdapter,
  toc: tocAdapter,
  'tree-view': treeViewAdapter,
} as const satisfies Record<string, Adapter>

function assertBindings(scenarios: readonly NavigationDataScenario[]): void {
  const productIds = scenarios.map(({ productId }) => productId).sort()
  const bindingIds = Object.keys(adapters).sort()
  if (JSON.stringify(productIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Baseline navigation/data renderer bindings do not match applicable ProductContract products: expected ${productIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountBaselineNavigationDataScenarios(
  container: HTMLElement,
  scenarios: readonly NavigationDataScenario[],
): Disposable {
  assertBindings(scenarios)
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    const adapter = adapters[scenario.productId as keyof typeof adapters]
    for (const scenarioCase of scenario.cases) {
      const host = document.createElement('section')
      host.id = `baseline-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'baseline'
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

export function mutateScenarioInput(
  scenario: NavigationDataScenario,
  caseId: string,
  key: string,
  value: JsonValue,
): NavigationDataScenario {
  return {
    ...scenario,
    cases: scenario.cases.map((scenarioCase) =>
      scenarioCase.id === caseId
        ? { ...scenarioCase, input: { ...scenarioCase.input, [key]: value } }
        : scenarioCase,
    ),
  }
}
