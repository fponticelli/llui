import { constant, each, noSend, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as chartC from '@llui/components/chart'
import * as sparklineC from '@llui/components/sparkline'
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
  SparklineTableHead,
  SparklineTableHeader,
  SparklineTableRow,
  SparklineTitle,
  SparklineTooltip,
  SparklineTooltipDate,
  SparklineTooltipValue,
} from '../components/ui/sparkline'
import { Button } from '../components/ui/button'
import { row, section } from './shared'

const CONFIG: ChartConfig = {
  desktop: { label: 'Desktop', color: 'var(--chart-1)' },
  mobile: { label: 'Mobile', color: 'var(--chart-2)' },
}

/**
 * A pie colours by CATEGORY, not by series — one series, one slice per row — so
 * its config is keyed by ROW label. `chartVars` does not care which: it emits
 * `--color-<key>` for whatever it is given, and the only thing that changes is
 * which key the mark reads.
 */
const BROWSER_CONFIG: ChartConfig = {
  chrome: { label: 'Chrome', color: 'var(--chart-1)' },
  safari: { label: 'Safari', color: 'var(--chart-2)' },
  firefox: { label: 'Firefox', color: 'var(--chart-3)' },
  edge: { label: 'Edge', color: 'var(--chart-4)' },
  other: { label: 'Other', color: 'var(--chart-5)' },
}
const BROWSER_KEYS = Object.keys(BROWSER_CONFIG)

const BROWSER_ROWS: chartC.ChartRow[] = BROWSER_KEYS.map((key, i) => ({
  label: BROWSER_CONFIG[key]!.label,
  values: { visitors: [275, 200, 187, 173, 90][i]! },
}))

const ROWS: chartC.ChartRow[] = [
  { label: 'Jan', values: { desktop: 186, mobile: 80 } },
  { label: 'Feb', values: { desktop: 305, mobile: 200 } },
  { label: 'Mar', values: { desktop: 237, mobile: 120 } },
  { label: 'Apr', values: { desktop: 73, mobile: 190 } },
  { label: 'May', values: { desktop: 209, mobile: 130 } },
  { label: 'Jun', values: { desktop: 214, mobile: 140 } },
]

// ── Sparkline ─────────────────────────────────────────────────────────────
//
// Fixed timestamps, never `Date.now()`: the geometry is a pure function of
// state, so a demo that seeded "now" from the clock would render differently
// on the server than in the browser and rewrite every gridline on hydration.

/** 14 readings, 2026-02-03 to 2026-08-11 — the issue's own example series. */
const READINGS: sparklineC.SparklinePoint[] = [
  { at: Date.UTC(2026, 1, 3), value: 128, grain: 'spot' },
  { at: Date.UTC(2026, 1, 17), value: 124, grain: 'spot' },
  { at: Date.UTC(2026, 2, 2), value: 119, grain: 'spot' },
  { at: Date.UTC(2026, 2, 19), value: 121, grain: 'spot' },
  { at: Date.UTC(2026, 3, 6), value: 116, grain: 'session' },
  { at: Date.UTC(2026, 3, 21), value: 112, grain: 'session' },
  { at: Date.UTC(2026, 4, 4), value: 108, grain: 'session' },
  { at: Date.UTC(2026, 4, 18), value: 111, grain: 'session' },
  { at: Date.UTC(2026, 5, 1), value: 105, grain: 'daily' },
  { at: Date.UTC(2026, 5, 15), value: 98, grain: 'daily' },
  { at: Date.UTC(2026, 5, 29), value: 96, grain: 'daily' },
  { at: Date.UTC(2026, 6, 13), value: 92, grain: 'daily' },
  { at: Date.UTC(2026, 6, 27), value: 88, grain: 'daily' },
  { at: Date.UTC(2026, 7, 11), value: 94, grain: 'daily' },
]

/** The right edge sits five weeks past the last reading, so the series
 *  visibly trails off instead of looking current. */
const SPARK_NOW = Date.UTC(2026, 8, 15)

/** The same series with one ancient reading in front of it — what the
 *  leading-outlier trim exists for. */
const STRANDED: sparklineC.SparklinePoint[] = [
  { at: Date.UTC(2023, 4, 9), value: 141 },
  ...READINGS,
]

const SPARK_BOX = { width: 240, height: 56, padding: { top: 6, right: 6, bottom: 12, left: 6 } }

/** High bound ONLY: everything below 120 is acceptable, and no reading can be
 *  called low. A stateless T1 widget — `connect(constant(v), noSend, …)`. */
const SPARK_HIGH_ONLY = sparklineC.init({
  ...SPARK_BOX,
  points: READINGS,
  band: { high: 120 },
  now: SPARK_NOW,
})

/** The untrimmed and trimmed readings of the SAME stranded series, side by
 *  side. Trimming is opt-in precisely because it discards data. */
const SPARK_UNTRIMMED = sparklineC.init({
  ...SPARK_BOX,
  points: STRANDED,
  band: { low: 90, high: 120 },
})
const SPARK_TRIMMED = sparklineC.init({
  ...SPARK_BOX,
  points: STRANDED,
  band: { low: 90, high: 120 },
  trim: true,
})

export interface State {
  bars: chartC.ChartState
  trend: chartC.ChartState
  share: chartC.ChartState
  spark: sparklineC.SparklineState
}

export type Msg =
  | { type: 'bars'; msg: chartC.ChartMsg }
  | { type: 'trend'; msg: chartC.ChartMsg }
  | { type: 'share'; msg: chartC.ChartMsg }
  | { type: 'spark'; msg: sparklineC.SparklineMsg }

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
    share: chartC.init({
      // ONE series and many rows: the slices are the rows, which is how a pie
      // is actually shaped and how shadcn's own pie data is shaped too.
      series: [{ key: 'visitors', label: 'Visitors', mark: 'bar' }],
      rows: BROWSER_ROWS,
      domain: 'share',
      coord: 'polar',
      innerRadius: 0.5,
      label: 'Visitors by browser',
      description: 'Share of visitors by browser, as a donut.',
      width: 420,
      height: 420,
    }),
    spark: sparklineC.init({
      ...SPARK_BOX,
      points: READINGS,
      band: { low: 90, high: 120 },
      now: SPARK_NOW,
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
    case 'share':
      return [{ ...state, share: chartC.update(state.share, msg.msg)[0] }, []]
    case 'spark':
      return [{ ...state, spark: sparklineC.update(state.spark, msg.msg)[0] }, []]
  }
}

/**
 * One renderer, both coordinate systems. Nothing below asks whether the chart
 * is cartesian or polar — the machine's derived geometry already answers it,
 * because `utils/projection.ts` is the only place that knows the difference.
 */
/**
 * What differs between a value chart and a share chart, and nothing else.
 *
 * A pie is coloured, legended and tabulated by ROW; every other mark here is
 * coloured, legended and tabulated by SERIES. That is the only axis on which
 * the two disagree — the geometry, the hit test, the tooltip and the a11y table
 * all come out of the same machine — so it is the only thing parameterised.
 */
interface PlotOptions {
  config: ChartConfig
  rows: chartC.ChartRow[]
  /** Which `--color-<key>` a mark reads. Rows for a pie, series otherwise. */
  colorKey: (mark: chartC.ChartMark) => string
  /** The colour the tooltip swatch takes for the row under the cursor. */
  tooltipColorKey: (activeIndex: number | null, seriesKey: string) => string
  /**
   * Legend entries. `null` renders the interactive series legend; a pie passes
   * a plain list because isolating one SLICE is not a thing a pie can do — the
   * remaining slices would still have to fill the circle, so the picture would
   * either lie or not change.
   */
  legend: { key: string; label: string }[] | null
  /** Column heading for the a11y table's first column. */
  rowHeading: string
  /** The value columns: one per series, or a single share column for a pie. */
  columns: { label: string; cell: (row: chartC.ChartRow) => string }[]
}

const seriesOptions = (): PlotOptions => ({
  config: CONFIG,
  rows: ROWS,
  colorKey: (m) => m.seriesKey,
  tooltipColorKey: (_i, seriesKey) => seriesKey,
  legend: null,
  rowHeading: 'Month',
  columns: Object.keys(CONFIG).map((key) => ({
    label: CONFIG[key]!.label,
    cell: (row) => String(row.values[key] ?? 0),
  })),
})

function plot(
  state: Signal<chartC.ChartState>,
  send: Send<chartC.ChartMsg>,
  id: string,
  opts: PlotOptions = seriesOptions(),
): Mountable {
  const parts = chartC.connect(state, send, { id })
  return ChartContainer({ ...parts.root, style: chartVars(opts.config) }, [
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
                style: `--mark-color:var(--color-${opts.colorKey(mark)})`,
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
                dx: t.map((v) => (v.anchor === 'end' ? -6 : 0)),
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
              ChartTooltipIndicator({
                // Reactive, not snapshotted: under a share domain the swatch
                // follows the active ROW, which changes without the row here
                // being rebuilt (its key is the series, and there is only one).
                style: state.map(
                  (s) =>
                    `--mark-color:var(--color-${opts.tooltipColorKey(s.activeIndex, seriesKey)})`,
                ),
              }),
              ChartTooltipName([text(r.at('label'))]),
              ChartTooltipValue([
                text(
                  r.map((v) =>
                    v.share === null
                      ? String(v.value)
                      : `${v.value} (${Math.round(v.share * 100)}%)`,
                  ),
                ),
              ]),
            ]),
          ]
        },
      }),
    ]),

    ChartLegend(
      opts.legend === null
        ? Object.keys(opts.config).map((key) =>
            ChartLegendItem({ ...parts.legendItem(key) }, [
              ChartLegendSwatch({ style: `--mark-color:var(--color-${key})` }),
              text(opts.config[key]!.label),
            ]),
          )
        : opts.legend.map((entry) =>
            // No `legendItem` here: that bag isolates a SERIES, and a pie has
            // one. Swatch and label only, so the legend states what the colours
            // mean without offering an interaction that cannot work.
            ChartLegendItem({ 'data-scope': 'chart', 'data-part': 'legend-item' }, [
              ChartLegendSwatch({ style: `--mark-color:var(--color-${entry.key})` }),
              text(entry.label),
            ]),
          ),
    ),

    // The real screen-reader path. `role="img"` names the chart; this is what
    // makes its NUMBERS readable.
    ChartTable({ ...parts.table }, [
      ChartTableHead([
        ChartTableRow([
          ChartTableHeader({ scope: 'col' }, [text(opts.rowHeading)]),
          ...opts.columns.map((c) => ChartTableHeader({ scope: 'col' }, [text(c.label)])),
        ]),
      ]),
      ChartTableBody(
        opts.rows.map((r) =>
          ChartTableRow([
            ChartTableHeader({ scope: 'row' }, [text(r.label)]),
            ...opts.columns.map((c) => ChartTableCell([text(c.cell(r))])),
          ]),
        ),
      ),
    ]),
  ])
}

const BROWSER_TOTAL = BROWSER_ROWS.reduce((a, r) => a + (r.values.visitors ?? 0), 0)

const shareOptions = (): PlotOptions => ({
  config: BROWSER_CONFIG,
  rows: BROWSER_ROWS,
  // The mark's ROW index picks the colour: one series, one slice per row.
  colorKey: (m) => BROWSER_KEYS[m.index ?? 0] ?? BROWSER_KEYS[0]!,
  tooltipColorKey: (i) => BROWSER_KEYS[i ?? 0] ?? BROWSER_KEYS[0]!,
  legend: BROWSER_KEYS.map((key) => ({ key, label: BROWSER_CONFIG[key]!.label })),
  rowHeading: 'Browser',
  columns: [
    { label: 'Visitors', cell: (row) => String(row.values.visitors ?? 0) },
    {
      label: 'Share',
      cell: (row) => `${Math.round(((row.values.visitors ?? 0) / BROWSER_TOTAL) * 100)}%`,
    },
  ],
})

/**
 * One sparkline. The SAME renderer serves the interactive slice and the two
 * stateless ones — `connect(constant(v), noSend, …)` is the T1 tier, so a
 * widget whose values are fixed for the life of the node needs no hoisted
 * state and no dispatcher.
 *
 * Layer order is the whole reason `parts.layer` exists: band, then grid, then
 * the granularity track, then the "now" edge, then the line, then the dots.
 * An SVG has no z-index — document order IS the stacking.
 */
function spark(
  state: Signal<sparklineC.SparklineState>,
  send: Send<sparklineC.SparklineMsg>,
  id: string,
  label: string,
  description: string,
): Mountable {
  const parts = sparklineC.connect(state, send, { id })
  return Sparkline({ ...parts.root }, [
    SparklineSvg({ ...parts.svg, class: 'h-14 w-60' }, [
      // FIRST children of the <svg>: this is what `aria-labelledby` points at.
      SparklineTitle({ ...parts.title }, [text(label)]),
      SparklineDesc({ ...parts.desc }, [text(description)]),

      SparklineBand({ ...parts.band }),
      SparklineLayer({ ...parts.layer }, [
        each(parts.ticks, {
          key: (t: sparklineC.SparklineTick) => t.key,
          render: (t: Signal<sparklineC.SparklineTick>) => [
            SparklineGrid({ ...parts.tickProps(t) }),
          ],
        }),
      ]),
      SparklineLayer({ ...parts.layer }, [
        each(parts.spans, {
          key: (sp: sparklineC.SparklineSpan) => sp.key,
          render: (sp: Signal<sparklineC.SparklineSpan>) => [
            SparklineSpan({ ...parts.spanProps(sp) }),
          ],
        }),
      ]),
      SparklineNow({ ...parts.now }),
      SparklineLine({ ...parts.line }),
      SparklineLayer({ ...parts.layer }, [
        each(parts.dots, {
          key: (d: sparklineC.SparklineDot) => d.key,
          render: (d: Signal<sparklineC.SparklineDot>) => [SparklineDot({ ...parts.dotProps(d) })],
        }),
      ]),
    ]),

    // Positioned against the CONTAINER in viewBox percentages, so it tracks its
    // dot at any CSS size without a second measurement.
    SparklineTooltip({ ...parts.tooltip }, [
      SparklineTooltipValue([
        text(parts.activeDot.map((d) => (d === null ? '' : String(d.value)))),
      ]),
      SparklineTooltipDate([
        text(parts.activeDot.map((d) => (d === null ? '' : sparklineC.isoDay(d.at)))),
      ]),
    ]),

    // The real screen-reader path. `role="img"` names the trend; this is what
    // makes its NUMBERS readable.
    SparklineTable({ ...parts.table }, [
      SparklineTableHead([
        SparklineTableRow([
          SparklineTableHeader([text('Date')]),
          SparklineTableHeader([text('Value')]),
          SparklineTableHeader([text('Against band')]),
        ]),
      ]),
      SparklineTableBody([
        each(parts.rows, {
          key: (r: sparklineC.SparklineRow) => `${r.at}`,
          render: (r: Signal<sparklineC.SparklineRow>) => [
            SparklineTableRow([
              SparklineTableCell([text(r.at('day'))]),
              SparklineTableCell([text(r.map((v) => String(v.value)))]),
              SparklineTableCell([text(r.at('tone'))]),
            ]),
          ],
        }),
      ]),
    ]),
  ])
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const barsSend = (m: chartC.ChartMsg): void => send({ type: 'bars', msg: m })
  const trendSend = (m: chartC.ChartMsg): void => send({ type: 'trend', msg: m })
  const shareSend = (m: chartC.ChartMsg): void => send({ type: 'share', msg: m })
  const sparkSend = (m: sparklineC.SparklineMsg): void => send({ type: 'spark', msg: m })

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
    section(
      'Chart — pie, donut & radial',
      'There is no `pie` mark. `domain: "share"` allocates the independent axis in PROPORTION to each value instead of in equal slots, which moves the magnitude from a bar\'s height onto a slice\'s extent — and that is the whole of a pie. So the same state is a donut in polar and a 100%-share bar in cartesian, and `horizontal` (which already means "the independent axis moves off its default screen axis") reads in polar as "off the angle, onto the radius": concentric radial bars.',
      [
        plot(state.at('share'), shareSend, 'demo-share', shareOptions()),
        row('Shape', [
          Button(
            {
              variant: 'outline',
              size: 'sm',
              onClick: () => {
                shareSend({ type: 'setDomain', domain: 'share' })
                shareSend({ type: 'setCoord', coord: 'polar' })
                shareSend({ type: 'setHorizontal', horizontal: false })
                shareSend({ type: 'setInnerRadius', value: 0 })
                shareSend({ type: 'setSize', width: 420, height: 420 })
              },
            },
            [text('Pie')],
          ),
          Button(
            {
              variant: 'outline',
              size: 'sm',
              onClick: () => {
                shareSend({ type: 'setDomain', domain: 'share' })
                shareSend({ type: 'setCoord', coord: 'polar' })
                shareSend({ type: 'setHorizontal', horizontal: false })
                shareSend({ type: 'setInnerRadius', value: 0.5 })
                shareSend({ type: 'setSize', width: 420, height: 420 })
              },
            },
            [text('Donut')],
          ),
          Button(
            {
              variant: 'outline',
              size: 'sm',
              onClick: () => {
                // The SAME data and the same domain, re-projected. This is the
                // reason a pie is a domain rather than a mark type.
                //
                // `horizontal` stays FALSE: under a share domain the slice
                // extents are the INDEPENDENT axis, so leaving it off runs them
                // left-to-right across one full-height bar. Turning it on is
                // also a real chart — the stripes stack vertically with their
                // HEIGHTS proportional — but it is a different picture, and it
                // is not the one a pie unrolls into.
                shareSend({ type: 'setDomain', domain: 'share' })
                shareSend({ type: 'setCoord', coord: 'cartesian' })
                shareSend({ type: 'setHorizontal', horizontal: false })
                shareSend({ type: 'setSize', width: 640, height: 120 })
              },
            },
            [text('100% bar')],
          ),
          Button(
            {
              variant: 'outline',
              size: 'sm',
              onClick: () => {
                // Back to a VALUE domain: arc length states the magnitude, so
                // the rings are evenly spaced and the value axis returns.
                shareSend({ type: 'setDomain', domain: 'value' })
                shareSend({ type: 'setCoord', coord: 'polar' })
                shareSend({ type: 'setHorizontal', horizontal: true })
                shareSend({ type: 'setInnerRadius', value: 0.2 })
                shareSend({ type: 'setSize', width: 420, height: 420 })
              },
            },
            [text('Radial bars')],
          ),
        ]),
      ],
    ),
    section(
      'Sparkline',
      'A cell-sized trend, and a pure function rather than a machine: `sparklineGeometry(points, opts)` needs no signal, no dispatcher and no mount, so fifty of them in a table cost fifty calls. `init`/`update`/`connect` sit beside it and add exactly one fact — which point the cursor is on. Gridlines land on real calendar boundaries (the ladder coarsens hour → day → week → month → quarter → year from the span), the shaded band reads three ways from one or both bounds, each dot is classified against it, and the dashed right edge is "now" — so a series five weeks stale visibly trails off instead of looking current. Hover it, or Tab to it and use the arrow keys.',
      [
        row('Both bounds — hover or arrow-key it', [
          spark(
            state.at('spark'),
            sparkSend,
            'demo-spark',
            'Readings against 90-120',
            'Fourteen readings from 2026-02-03 to 2026-08-11, five weeks stale.',
          ),
        ]),
        row('High bound only — nothing can be called low (stateless: constant + noSend)', [
          spark(
            constant(SPARK_HIGH_ONLY),
            noSend,
            'demo-spark-high',
            'Readings against a 120 ceiling',
            'A high bound alone shades everything below it.',
          ),
        ]),
        row('Leading-outlier trim: off (default), then on', [
          spark(
            constant(SPARK_UNTRIMMED),
            noSend,
            'demo-spark-untrimmed',
            'One 2023 reading squashing the rest',
            'Trimming is off by default: a chart that silently drops a reading is worse than a squashed one.',
          ),
          spark(
            constant(SPARK_TRIMMED),
            noSend,
            'demo-spark-trimmed',
            'The same series, leading outlier trimmed',
            'The first gap is more than four times the median of the rest, so the 2023 reading goes.',
          ),
        ]),
      ],
    ),
  ]
}
