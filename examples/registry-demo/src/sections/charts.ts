import { each, g, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as chartC from '@llui/components/chart'
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
  ChartTableHead,
  ChartTableHeader,
  ChartTableRow,
  ChartTitle,
  ChartTooltipContent,
  ChartTooltipIndicator,
  ChartTooltipItem,
  ChartTooltipLabel,
  ChartTooltipName,
  ChartTooltipValue,
  chartVars,
  type ChartConfig,
} from '../components/ui/chart'
import { Button } from '../components/ui/button'
import { row, section } from './shared'

const CONFIG: ChartConfig = {
  desktop: { label: 'Desktop', color: 'var(--chart-1)' },
  mobile: { label: 'Mobile', color: 'var(--chart-2)' },
}

const ROWS: chartC.ChartRow[] = [
  { label: 'Jan', values: { desktop: 186, mobile: 80 } },
  { label: 'Feb', values: { desktop: 305, mobile: 200 } },
  { label: 'Mar', values: { desktop: 237, mobile: 120 } },
  { label: 'Apr', values: { desktop: 73, mobile: 190 } },
  { label: 'May', values: { desktop: 209, mobile: 130 } },
  { label: 'Jun', values: { desktop: 214, mobile: 140 } },
]

export interface State {
  bars: chartC.ChartState
  trend: chartC.ChartState
}

export type Msg = { type: 'bars'; msg: chartC.ChartMsg } | { type: 'trend'; msg: chartC.ChartMsg }

export const init = (): [State, never[]] => [
  {
    bars: chartC.init({
      series: [
        { key: 'desktop', label: 'Desktop', mark: 'bar' },
        { key: 'mobile', label: 'Mobile', mark: 'bar' },
      ],
      rows: ROWS,
      label: 'Visitors by device',
      description: 'Desktop and mobile visitors for the first six months.',
      width: 640,
      height: 300,
    }),
    trend: chartC.init({
      series: [
        { key: 'desktop', label: 'Desktop', mark: 'area', curve: 'monotone' },
        { key: 'mobile', label: 'Mobile', mark: 'line', curve: 'monotone' },
      ],
      rows: ROWS,
      label: 'Visitor trend',
      description: 'Desktop as a filled area, mobile as a line.',
      width: 640,
      height: 300,
    }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'bars':
      return [{ ...state, bars: chartC.update(state.bars, msg.msg)[0] }, []]
    case 'trend':
      return [{ ...state, trend: chartC.update(state.trend, msg.msg)[0] }, []]
  }
}

/**
 * One renderer, both coordinate systems. Nothing below asks whether the chart
 * is cartesian or polar — the machine's derived geometry already answers it,
 * because `utils/projection.ts` is the only place that knows the difference.
 */
function plot(
  state: Signal<chartC.ChartState>,
  send: Send<chartC.ChartMsg>,
  id: string,
): Mountable {
  const parts = chartC.connect(state, send, { id })
  return ChartContainer({ ...parts.root, style: chartVars(CONFIG) }, [
    ChartSvg({ ...parts.svg }, [
      // FIRST children of the <svg>: this is what `aria-labelledby` points at.
      ChartTitle({ ...parts.title }, [text(state.at('label'))]),
      ChartDesc({ ...parts.desc }, [text(state.at('description'))]),

      // Grid UNDER the marks, labels OVER them — see the label layer at the
      // bottom. In polar the value axis runs straight through the plot, so a
      // label layer drawn first is painted over by every wedge that crosses it.
      ChartLayer({ ...parts.layer }, [
        each(parts.gridLines, {
          key: (l: chartC.ChartGridLine) => String(l.value),
          render: (l: Signal<chartC.ChartGridLine>) => [ChartGrid({ ...parts.grid, d: l.at('d') })],
        }),
      ]),

      ChartLayer({ ...parts.layer }, [
        each(parts.marks, {
          // A bar is one mark per row, a line or area one per series — the key
          // has to carry both or reordering the rows reuses the wrong node.
          key: (m: chartC.ChartMark) => `${m.seriesKey}:${m.mark}:${m.index ?? 'all'}`,
          render: (m: Signal<chartC.ChartMark>) => {
            const mark = m.peek()
            return [
              ChartMark({
                ...parts.markProps(mark),
                d: m.at('d'),
                'data-active': m.map((v) => (v.active ? '' : undefined)),
                'data-dimmed': m.map((v) => (v.dimmed ? '' : undefined)),
                style: `--mark-color:var(--color-${mark.seriesKey})`,
              }),
            ]
          },
        }),
      ]),

      ChartLayer({ ...parts.layer }, [
        each(parts.vertices, {
          key: (v: chartC.ChartVertex) => `${v.seriesKey}:${v.index}`,
          render: (v: Signal<chartC.ChartVertex>) => {
            // One-shot by design and snapshotted where the compiler can see it:
            // the row KEY is the series, so this vertex's colour cannot change
            // without the row being rebuilt.
            const seriesKey = v.peek().seriesKey
            return [
              ChartDot({
                'data-scope': 'chart',
                'data-part': 'dot',
                'data-series': seriesKey,
                cx: v.at('x'),
                cy: v.at('y'),
                r: 4,
                'data-active': v.map((p) => (p.active ? '' : undefined)),
                style: `--mark-color:var(--color-${seriesKey})`,
              }),
            ]
          },
        }),
      ]),

      ChartLayer({ ...parts.layer }, [
        each(parts.categoryTicks, {
          key: (t: chartC.ChartCategoryTick) => String(t.index),
          render: (t: Signal<chartC.ChartCategoryTick>) => [
            ChartAxisLabel(
              {
                ...parts.axisLabel,
                x: t.at('x'),
                y: t.at('y'),
                dy: t.map((v) => (v.baseline === 'hanging' ? 6 : 0)),
                'text-anchor': t.at('anchor'),
                'dominant-baseline': t.at('baseline'),
                'data-active': t.map((v) => (v.active ? '' : undefined)),
              },
              [text(t.at('label'))],
            ),
          ],
        }),
        each(parts.gridLines, {
          key: (l: chartC.ChartGridLine) => `v${l.value}`,
          render: (l: Signal<chartC.ChartGridLine>) => [
            ChartAxisLabel(
              {
                ...parts.axisLabel,
                x: l.at('x'),
                y: l.at('y'),
                'text-anchor': l.at('anchor'),
                'dominant-baseline': l.at('baseline'),
                dx: l.map((v) => (v.anchor === 'end' ? -6 : 0)),
              },
              [text(l.at('label'))],
            ),
          ],
        }),
      ]),
    ]),

    // Positioned against the CONTAINER, in viewBox percentages, so it tracks
    // its mark at any CSS size without a second measurement.
    ChartTooltipContent({ ...parts.tooltip }, [
      ChartTooltipLabel([text(parts.activeLabel)]),
      each(parts.tooltipRows, {
        key: (r: chartC.ChartTooltipRow) => r.seriesKey,
        render: (r: Signal<chartC.ChartTooltipRow>) => {
          const seriesKey = r.peek().seriesKey
          return [
            ChartTooltipItem([
              ChartTooltipIndicator({ style: `--mark-color:var(--color-${seriesKey})` }),
              ChartTooltipName([text(r.at('label'))]),
              ChartTooltipValue([text(r.at('value').map(String))]),
            ]),
          ]
        },
      }),
    ]),

    ChartLegend(
      Object.keys(CONFIG).map((key) =>
        ChartLegendItem({ ...parts.legendItem(key) }, [
          ChartLegendSwatch({ style: `--mark-color:var(--color-${key})` }),
          text(CONFIG[key]!.label),
        ]),
      ),
    ),

    // The real screen-reader path. `role="img"` names the chart; this is what
    // makes its NUMBERS readable.
    ChartTable({ ...parts.table }, [
      ChartTableHead([
        ChartTableRow([
          ChartTableHeader({ scope: 'col' }, [text('Month')]),
          ...Object.values(CONFIG).map((c) => ChartTableHeader({ scope: 'col' }, [text(c.label)])),
        ]),
      ]),
      ChartTableBody(
        ROWS.map((r) =>
          ChartTableRow([
            ChartTableHeader({ scope: 'row' }, [text(r.label)]),
            ...Object.keys(CONFIG).map((key) => ChartTableCell([text(String(r.values[key] ?? 0))])),
          ]),
        ),
      ),
    ]),
  ])
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const barsSend = (m: chartC.ChartMsg): void => send({ type: 'bars', msg: m })
  const trendSend = (m: chartC.ChartMsg): void => send({ type: 'trend', msg: m })

  const coordRow = (slice: Signal<chartC.ChartState>, to: Send<chartC.ChartMsg>): Mountable =>
    row('Projection', [
      // The viewBox is STATE, so a consumer picks the box that suits the
      // projection — a wide one for a cartesian plot, a square for a circle.
      // Nothing in the machine forces it; `frameOf` centres on min(w, h) either
      // way, it just leaves gutters in a box that does not match.
      Button(
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => {
            to({ type: 'setCoord', coord: 'cartesian' })
            to({ type: 'setSize', width: 640, height: 300 })
          },
        },
        [text('Cartesian')],
      ),
      Button(
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => {
            to({ type: 'setCoord', coord: 'polar' })
            to({ type: 'setSize', width: 420, height: 420 })
          },
        },
        [text('Polar')],
      ),
      Button(
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => to({ type: 'setStacked', stacked: !slice.peek().stacked }),
        },
        [text('Toggle stacked')],
      ),
      Button(
        {
          variant: 'outline',
          size: 'sm',
          onClick: () =>
            to({ type: 'setInnerRadius', value: slice.peek().innerRadius > 0 ? 0 : 0.4 }),
        },
        [text('Toggle donut')],
      ),
      Button(
        {
          variant: 'outline',
          size: 'sm',
          onClick: () => to({ type: 'setHorizontal', horizontal: !slice.peek().horizontal }),
        },
        [text('Toggle horizontal')],
      ),
    ])

  return [
    section(
      'Chart — bars',
      'One `coord` field decides everything. Switching to polar turns each bar into a wedge, each gridline into a ring, and the hit test from "nearest x" into "nearest angle" — with no change to the view, the series or the data.',
      [plot(state.at('bars'), barsSend, 'demo-bars'), coordRow(state.at('bars'), barsSend)],
    ),
    section(
      'Chart — lines & areas',
      'The same projection seam: a monotone area and a line in cartesian become a filled radar polygon and a radar outline in polar. Polar declines `monotone` rather than approximating it — the no-overshoot guarantee is undefined on a closed angular loop.',
      [plot(state.at('trend'), trendSend, 'demo-trend'), coordRow(state.at('trend'), trendSend)],
    ),
  ]
}
