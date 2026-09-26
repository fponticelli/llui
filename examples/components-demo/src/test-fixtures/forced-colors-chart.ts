// TEST-ONLY fixture (registry/test/forced-colors-chart-series.browser.test.ts).
// Not part of the curated demo — a chart with THREE bar and THREE area
// series, enough that a flat `fill: CanvasText` under forced colors would
// make same-mark series genuinely indistinguishable (#264).
import {
  button,
  circle,
  component,
  div,
  each,
  mountApp,
  path,
  span,
  svg,
  svgDesc,
  svgTitle,
  text,
  g,
  type Mountable,
} from '@llui/dom'
import * as chartC from '@llui/components/chart'
import { chartForcedColorPatterns } from '@llui/components/chart'

const SERIES = [
  { key: 'bar1', label: 'Bar A', mark: 'bar' as const },
  { key: 'bar2', label: 'Bar B', mark: 'bar' as const },
  { key: 'bar3', label: 'Bar C', mark: 'bar' as const },
  { key: 'area1', label: 'Area A', mark: 'area' as const },
  { key: 'area2', label: 'Area B', mark: 'area' as const },
  { key: 'area3', label: 'Area C', mark: 'area' as const },
]
const ROWS: chartC.ChartRow[] = [
  { label: 'Q1', values: { bar1: 12, bar2: 9, bar3: 6, area1: 14, area2: 10, area3: 7 } },
  { label: 'Q2', values: { bar1: 18, bar2: 13, bar3: 8, area1: 20, area2: 15, area3: 9 } },
]

// Seven series (#264 review item 7): one MORE than the seven-name cue
// vocabulary, so a chart declaring an eighth series would repeat one name —
// this fixture only needs to prove seven stay pairwise distinct, which is
// what `SERIES_CUES.length === 7` promises.
const SEVEN_SERIES = Array.from({ length: 7 }, (_, i) => ({
  key: `s${i}`,
  label: `Series ${i}`,
  mark: 'bar' as const,
}))
const SEVEN_ROWS: chartC.ChartRow[] = [
  {
    label: 'Q1',
    values: Object.fromEntries(SEVEN_SERIES.map((s, i) => [s.key, 10 + i])),
  },
]

// A single-series PIE (share domain + polar coord): one series, several
// rows — every wedge used to get the SAME per-series cue, one undifferentiated
// ring (#264 review item 7). Five rows, one more than the five ORIGINAL cue
// names, so this also proves the per-ROW cue keeps cycling correctly.
const PIE_SERIES = [{ key: 'share', label: 'Share', mark: 'bar' as const }]
const PIE_ROWS: chartC.ChartRow[] = [
  { label: 'A', values: { share: 10 } },
  { label: 'B', values: { share: 20 } },
  { label: 'C', values: { share: 15 } },
  { label: 'D', values: { share: 25 } },
  { label: 'E', values: { share: 30 } },
]

interface ChartFixtureOptions {
  readonly series: readonly chartC.ChartSeries[]
  readonly rows: readonly chartC.ChartRow[]
  readonly domain?: chartC.ChartDomain
  readonly coord?: chartC.ChartCoord
  readonly legend?: boolean
}

function chartFixture(
  chartId: string,
  domIdPrefix: string,
  opts: ChartFixtureOptions = { series: SERIES, rows: ROWS },
): ReturnType<typeof component<{ chart: chartC.ChartState }, chartC.ChartMsg>> {
  return component<{ chart: chartC.ChartState }, chartC.ChartMsg>({
    name: 'ForcedColorsChartFixture',
    init: () => [
      {
        chart: chartC.init({
          series: [...opts.series],
          rows: [...opts.rows],
          label: 'Series fixture',
          domain: opts.domain,
          coord: opts.coord,
        }),
      },
      [],
    ],
    update: (state, msg) => [{ chart: chartC.update(state.chart, msg)[0] }, []],
    view: ({ state, send }): readonly Mountable[] => {
      const parts = chartC.connect(state.at('chart'), send, { id: chartId })
      // `parts.root` carries the per-instance forced-colors fill custom
      // properties (#264 review item 3) — every mark reads them by
      // inheritance, so the root must be a real ancestor in the mounted tree
      // even though this fixture has no other use for a wrapping element.
      return [
        div({ ...parts.root, id: `${domIdPrefix}-root` }, [
          svg(
            {
              ...parts.svg,
              id: `${domIdPrefix}-svg`,
              style: 'width:600px;height:300px;display:block',
            },
            [
              svgTitle({ ...parts.title }, [text('Series fixture')]),
              svgDesc({ ...parts.desc }, [text('Three bar, three area series')]),
              chartForcedColorPatterns(chartId),
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
                    return [path({ ...parts.markProps(m), 'data-active': '' })]
                  },
                }),
                each(parts.vertices, {
                  key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
                  render: (vertex) => {
                    const v = vertex.peek()
                    return [circle({ ...parts.dotProps(v), r: 4, 'data-active': '' })]
                  },
                }),
              ]),
            ],
          ),
          ...(opts.legend
            ? [
                div(
                  { id: `${domIdPrefix}-legend` },
                  opts.series.map((s) =>
                    button({ ...parts.legendItem(s.key) }, [
                      span({ ...parts.legendSwatch(s.key), id: `${domIdPrefix}-swatch-${s.key}` }),
                      text(s.label),
                    ]),
                  ),
                ),
              ]
            : []),
        ]),
      ]
    },
  })
}

// A HIDDEN chart mounted FIRST, then the real, VISIBLE one — the exact
// document order that used to blank every visible chart's pattern fills
// under the old shared, global pattern id (#264 review item 3). Distinct
// `chartId`s ('forced-colors-chart-hidden' / 'forced-colors-chart') prove
// the fix: each instance's marks reference only its OWN patterns.
mountApp(
  document.getElementById('hidden-app')!,
  chartFixture('forced-colors-chart-hidden', 'chart-hidden', {
    series: SERIES,
    rows: ROWS,
    legend: true,
  }),
)
mountApp(
  document.getElementById('app')!,
  chartFixture('forced-colors-chart', 'chart', { series: SERIES, rows: ROWS, legend: true }),
)
mountApp(
  document.getElementById('app-seven')!,
  chartFixture('forced-colors-chart-seven', 'chart-seven', {
    series: SEVEN_SERIES,
    rows: SEVEN_ROWS,
  }),
)
mountApp(
  document.getElementById('app-pie')!,
  chartFixture('forced-colors-chart-pie', 'chart-pie', {
    series: PIE_SERIES,
    rows: PIE_ROWS,
    domain: 'share',
    coord: 'polar',
  }),
)
