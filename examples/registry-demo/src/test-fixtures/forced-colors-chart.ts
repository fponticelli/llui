// TEST-ONLY fixture (registry/test/forced-colors-chart-series.browser.test.ts).
// Not part of the curated demo — a chart with THREE bar and THREE area
// series, enough that a flat `fill: CanvasText` under forced colors would
// make same-mark series genuinely indistinguishable (#264). Boots through
// this example's own vite config (llui() + tailwindcss()) so the compiled
// Tailwind output is the REAL production CSS, not a hand-approximated copy.
import { component, mountApp, text, type Mountable } from '@llui/dom'
import * as chartC from '@llui/components/chart'
import { chartForcedColorPatterns } from '@llui/components/chart'
import {
  ChartContainer,
  ChartDesc,
  ChartDot,
  ChartGrid,
  ChartLayer,
  ChartMark,
  ChartSvg,
  ChartTitle,
} from '../components/ui/chart'
import { each } from '@llui/dom'

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
      ChartContainer({ ...parts.root, id: 'chart-root' }, [
        ChartSvg(
          { ...parts.svg, id: 'chart-svg', style: 'width:600px;height:300px;display:block' },
          [
            ChartTitle({ ...parts.title }, [text('Series fixture')]),
            ChartDesc({ ...parts.desc }, [text('Three bar, three area series')]),
            chartForcedColorPatterns(),
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
                  return [ChartMark({ ...parts.markProps(m), 'data-active': '' })]
                },
              }),
              each(parts.vertices, {
                key: (vertex) => `${vertex.seriesKey}:${vertex.index}`,
                render: (vertex) => {
                  const v = vertex.peek()
                  return [ChartDot({ ...parts.dotProps(v), r: 4, 'data-active': '' })]
                },
              }),
            ]),
          ],
        ),
      ]),
    ]
  },
})

mountApp(document.getElementById('app')!, definition)
