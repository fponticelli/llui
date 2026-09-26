// TEST-ONLY fixture (registry/test/forced-colors-chart-series.browser.test.ts).
// Not part of the curated demo — a chart with THREE bar and THREE area
// series, enough that a flat `fill: CanvasText` under forced colors would
// make same-mark series genuinely indistinguishable (#264).
import {
  circle,
  component,
  each,
  mountApp,
  path,
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

const definition = component<{ chart: chartC.ChartState }, chartC.ChartMsg>({
  name: 'ForcedColorsChartFixture',
  init: () => [{ chart: chartC.init({ series: SERIES, rows: ROWS, label: 'Series fixture' }) }, []],
  update: (state, msg) => [{ chart: chartC.update(state.chart, msg)[0] }, []],
  view: ({ state, send }): readonly Mountable[] => {
    const parts = chartC.connect(state.at('chart'), send, { id: 'forced-colors-chart' })
    return [
      svg({ ...parts.svg, id: 'chart-svg', style: 'width:600px;height:300px;display:block' }, [
        svgTitle({ ...parts.title }, [text('Series fixture')]),
        svgDesc({ ...parts.desc }, [text('Three bar, three area series')]),
        chartForcedColorPatterns(),
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
      ]),
    ]
  },
})

mountApp(document.getElementById('app')!, definition)
