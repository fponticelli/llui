/**
 * Charts — the `chart` machine, and the one thing it exists to demonstrate.
 *
 * `chart` derives GEOMETRY as data (path strings, points, tick placements) and
 * this section renders it with ordinary SVG element helpers. Nothing below asks
 * whether a chart is cartesian or polar: `coord` is ONE state field, and
 * `utils/projection.ts` is the only place that knows the difference. Switching
 * it re-projects every mark, gridline, tick, hit test and tooltip anchor from
 * the same series and the same rows — a line becomes a radar outline, a bar
 * becomes a wedge, a value rule becomes a ring.
 *
 * The same discipline explains the third card: there is no `pie` mark type,
 * because a pie is `domain: 'share'` — the independent axis allocated in
 * PROPORTION to each value instead of in equal slots, which moves the magnitude
 * off `v` and onto `u`. Under polar that is a pie or a donut; under cartesian
 * the SAME state is one full-width 100%-share bar.
 */
import {
  button,
  circle,
  div,
  each,
  g,
  p,
  path,
  span,
  svg,
  svgDesc,
  svgText,
  svgTitle,
  table,
  tbody,
  td,
  text,
  th,
  thead,
  tr,
} from '@llui/dom'
import type { Mountable, Renderable, Send, Signal } from '@llui/dom'
import * as chartC from '@llui/components/chart'
import { sectionGroup, card } from '../shared/ui'

/** The curve set, taken from the machine's own type so it cannot drift. */
type Curve = NonNullable<chartC.ChartSeries['curve']>

// ── Data ──────────────────────────────────────────────────────────────────

const MONTHS: chartC.ChartRow[] = [
  { label: 'Jan', values: { desktop: 186, mobile: 80 } },
  { label: 'Feb', values: { desktop: 305, mobile: 200 } },
  { label: 'Mar', values: { desktop: 237, mobile: 120 } },
  { label: 'Apr', values: { desktop: 73, mobile: 190 } },
  { label: 'May', values: { desktop: 209, mobile: 130 } },
  { label: 'Jun', values: { desktop: 214, mobile: 140 } },
]

/**
 * Three values on purpose: `310 + 779 + 45` is a total whose per-slice
 * fractions accumulate to 0.9999999999999999, so a share axis that closed the
 * last slice at the running sum instead of at exactly 1 would leave a hairline
 * seam of background at 12 o'clock on a full turn. Round numbers hide that.
 */
const BROWSERS: chartC.ChartRow[] = [
  { label: 'Safari', values: { visitors: 310 } },
  { label: 'Chrome', values: { visitors: 779 } },
  { label: 'Edge', values: { visitors: 45 } },
]

const SERIES_COLOR: Record<string, string> = {
  desktop: 'var(--chart-1)',
  mobile: 'var(--chart-2)',
}

/** A pie colours by CATEGORY, not by series — one series, one slice per row. */
const BROWSER_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-4)']

const CARTESIAN_BOX = { width: 640, height: 300 }
const POLAR_BOX = { width: 400, height: 400 }

// ── State ─────────────────────────────────────────────────────────────────

export interface State {
  traffic: chartC.ChartState
  trend: chartC.ChartState
  share: chartC.ChartState
  /**
   * Reveal the visually-hidden `<table>` every chart already renders. It is the
   * real screen-reader path — `role="img"` names the chart, the table carries
   * its numbers — and showing it is the only way a sighted reader can check
   * that it says the same thing the picture does.
   */
  showTable: boolean
}

export type Msg =
  | { type: 'traffic'; msg: chartC.ChartMsg }
  | { type: 'trend'; msg: chartC.ChartMsg }
  | { type: 'share'; msg: chartC.ChartMsg }
  /**
   * `curve` lives on `ChartSeries`, which no message writes — the series list
   * is consumer-owned data, exactly like `rows`. So the section rewrites its
   * own slice rather than reaching for a machine message that does not exist.
   */
  | { type: 'setCurve'; curve: Curve }
  | { type: 'toggleTable' }

export const init = (): [State, never[]] => [
  {
    traffic: chartC.init({
      series: [
        { key: 'desktop', label: 'Desktop', mark: 'bar' },
        { key: 'mobile', label: 'Mobile', mark: 'bar' },
      ],
      rows: MONTHS,
      label: 'Visitors by device',
      description: 'Desktop and mobile visitors for the first six months.',
      ...CARTESIAN_BOX,
    }),
    trend: chartC.init({
      series: [
        { key: 'desktop', label: 'Desktop', mark: 'area', curve: 'monotone' },
        { key: 'mobile', label: 'Mobile', mark: 'line', curve: 'monotone' },
      ],
      rows: MONTHS,
      label: 'Visitor trend',
      description: 'Desktop as a filled area, mobile as a line.',
      ...CARTESIAN_BOX,
    }),
    share: chartC.init({
      // ONE series and many rows: the slices ARE the rows, which is how pie
      // data is actually shaped.
      series: [{ key: 'visitors', label: 'Visitors', mark: 'bar' }],
      rows: BROWSERS,
      domain: 'share',
      coord: 'polar',
      innerRadius: 0.5,
      label: 'Visitors by browser',
      description: 'Share of visitors by browser, as a donut.',
      ...POLAR_BOX,
    }),
    showTable: false,
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'traffic':
      return [{ ...state, traffic: chartC.update(state.traffic, msg.msg)[0] }, []]
    case 'trend':
      return [{ ...state, trend: chartC.update(state.trend, msg.msg)[0] }, []]
    case 'share':
      return [{ ...state, share: chartC.update(state.share, msg.msg)[0] }, []]
    case 'setCurve':
      return [
        {
          ...state,
          trend: {
            ...state.trend,
            series: state.trend.series.map((s) => ({ ...s, curve: msg.curve })),
          },
        },
        [],
      ]
    case 'toggleTable':
      return [{ ...state, showTable: !state.showTable }, []]
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────

/**
 * What differs between a value chart and a share chart, and nothing else.
 *
 * A pie is coloured, legended and tabulated by ROW; every other mark here is
 * coloured, legended and tabulated by SERIES. The geometry, the hit test, the
 * tooltip and the accessible table all come out of the same machine, so that is
 * the only axis on which the two disagree and the only thing parameterised.
 */
interface PlotOptions {
  id: string
  /** The colour one drawn mark takes. */
  colorOf: (mark: chartC.ChartMark) => string
  /**
   * The colour one tooltip row's swatch takes, read from the row itself.
   *
   * A tooltip row IS a series, so for a value chart that is the whole answer.
   * A SHARE chart is the case this seam exists for: it has one series and
   * therefore one tooltip row, whose colour has to follow the ACTIVE ROW.
   *
   * The obvious spelling for that — `state.map((s) => …s.activeIndex…)` on the
   * swatch itself — is MISCOMPILED here, and silently: issue **#247**. A row
   * this simple lowers to the compiler's DIRECT tier, which rewrites a signal
   * expression rooted at an identifier spelled `state` into a read of
   * `ctx.state`: the mounted component's state. `state` here is this helper's
   * PARAMETER, holding a `state.at('share')` SLICE, so the mapper ran against
   * the demo's root state, `s.activeIndex` was `undefined`, and every slice
   * took the first colour while the label beside it named the right one.
   * Measured in the browser; nothing in the build, the types or any test can
   * see it, and renaming the parameter alone changes the verdict — recognition
   * is by bare identifier text (`STATE_ROOTS` is the one name `state`), so a
   * parameter named `slice` makes the tier decline and emit a correct
   * `eachArm` instead. Same family as #238 / #244.
   *
   * So the reactive read lives on a wrapper OUTSIDE the `each` as
   * {@link PlotOptions.tooltipActiveColorOf}, published as `--tooltip-color`,
   * and a share chart's swatch names that variable instead of a colour. This is
   * authoring AROUND #247, not a fix for it — do not restore the direct
   * spelling until that issue closes.
   */
  tooltipSwatchOf: (row: chartC.ChartTooltipRow) => string
  /**
   * The `--tooltip-color` a share chart's swatch reads, bound outside the
   * `each`. `null` for a chart whose rows already know their own colour.
   */
  tooltipActiveColorOf: ((state: chartC.ChartState) => string) | null
  /**
   * `null` renders the interactive series legend (clicking isolates a series).
   * A pie passes a plain list instead: isolating one SLICE is not a thing a pie
   * can do, because the remaining slices would still have to fill the circle.
   */
  legend: { label: string; color: string }[] | null
  /** Heading for the accessible table's first column. */
  rowHeading: string
  /** One value column per series, or a single share column for a pie. */
  columns: { label: string; cell: (row: chartC.ChartRow) => string }[]
}

function plot(
  state: Signal<chartC.ChartState>,
  send: Send<chartC.ChartMsg>,
  showTable: Signal<boolean>,
  opts: PlotOptions,
): Mountable {
  const parts = chartC.connect(state, send, { id: opts.id })
  const activeColor = opts.tooltipActiveColorOf

  return div(
    {
      ...parts.root,
      // The root sizes NOTHING: the plot box below owns the aspect ratio, so
      // revealing the accessible table adds height beside the plot instead of
      // taking it out of a locked box and squeezing the drawing (measured —
      // the first cut put both in one `aspect-video` column and the chart
      // collapsed to a sliver the moment the table appeared).
      //
      // The `data-domain` rule is what makes a pie readable: under a share
      // domain the wedges tile the whole circle with no gaps — they have to, or
      // each would misstate its share — so two adjacent slices of similar
      // colour meet on an invisible seam. A background-coloured stroke
      // separates them without taking any angle away from either.
      //
      // ONE string literal, deliberately: `scripts/lib/registry-classes.mjs`
      // reads a `class:` prop's literal initializer, and a `'a' + 'b'`
      // concatenation is an expression it cannot evaluate — so every class in
      // it would silently drop out of the Tailwind guard.
      class:
        "group/chart flex w-full flex-col text-xs data-[domain=share]:[&_[data-part='mark']]:stroke-background data-[domain=share]:[&_[data-part='mark']]:stroke-2",
    },
    [
      // The plot box. `aspect-video` for a plot and a square for a circle —
      // `data-coord` is published by the ROOT bag, so the box follows the
      // projection through the group with no second state field. It is also the
      // tooltip's positioned ancestor: the machine publishes `left`/`top` as
      // percentages of the viewBox, which only means anything against the box
      // holding the `<svg>`.
      div(
        {
          class:
            "relative flex aspect-video w-full items-center justify-center group-data-[coord=polar]/chart:aspect-square group-data-[coord=polar]/chart:max-h-[380px] [&_[data-part='svg']]:outline-none",
        },
        [
          svg(
            {
              ...parts.svg,
              class:
                'h-full min-h-0 w-full overflow-visible rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            },
            [
              // FIRST children of the <svg>: this is what `aria-labelledby` points
              // at, and what a screen reader announces for the whole chart.
              svgTitle({ ...parts.title }, [text(state.at('label'))]),
              svgDesc({ ...parts.desc }, [text(state.at('description'))]),

              // Grid UNDER the marks, labels OVER them. In polar the value axis
              // runs straight through the plot, so a label layer drawn first is
              // painted over by every wedge that crosses it.
              g({ ...parts.layer }, [
                each(parts.gridLines, {
                  key: (l: chartC.ChartGridLine) => String(l.value),
                  render: (l: Signal<chartC.ChartGridLine>) => [
                    path({
                      ...parts.grid,
                      d: l.at('d'),
                      class: 'fill-none stroke-border/50 stroke-1',
                    }),
                  ],
                }),
              ]),

              g({ ...parts.layer }, [
                each(parts.marks, {
                  // A bar is one mark per row, a line or an area one per series —
                  // the key has to carry both, or reordering reuses the wrong node.
                  key: (m: chartC.ChartMark) => `${m.seriesKey}:${m.mark}:${m.index ?? 'all'}`,
                  render: (m: Signal<chartC.ChartMark>) => {
                    const mark = m.peek()
                    return [
                      path({
                        ...parts.markProps(mark),
                        // `markProps` snapshots the mark it was given; `d`,
                        // `data-active` and `data-dimmed` all change without the
                        // row being rebuilt, so they are re-bound reactively.
                        d: m.at('d'),
                        'data-active': m.map((v) => (v.active ? '' : undefined)),
                        'data-dimmed': m.map((v) => (v.dimmed ? '' : undefined)),
                        style: `--mark-color:${opts.colorOf(mark)}`,
                        // `data-mark` picks the treatment and `--mark-color` the
                        // colour, so a series changes colour by changing the
                        // config and never the view. One string literal — see the
                        // container's note about the class extractor.
                        class:
                          'transition-opacity data-dimmed:opacity-25 data-active:opacity-100 data-[mark=bar]:fill-(--mark-color) data-[mark=area]:fill-(--mark-color) data-[mark=area]:opacity-70 data-[mark=line]:fill-none data-[mark=line]:stroke-(--mark-color) data-[mark=line]:stroke-2 data-[mark=line]:[stroke-linecap:round] data-[mark=line]:[stroke-linejoin:round]',
                      }),
                    ]
                  },
                }),
              ]),

              g({ ...parts.layer }, [
                each(parts.vertices, {
                  key: (v: chartC.ChartVertex) => `${v.seriesKey}:${v.index}`,
                  render: (v: Signal<chartC.ChartVertex>) => {
                    const vertex = v.peek()
                    return [
                      circle({
                        ...parts.dotProps(vertex),
                        cx: v.at('x'),
                        cy: v.at('y'),
                        r: 4,
                        'data-active': v.map((p2) => (p2.active ? '' : undefined)),
                        style: `--mark-color:${SERIES_COLOR[vertex.seriesKey] ?? 'var(--chart-1)'}`,
                        // Hidden until its row is active: that is what makes the
                        // keyboard cursor visible without a permanent dot layer.
                        class:
                          'fill-(--mark-color) stroke-background stroke-2 opacity-0 transition-opacity data-active:opacity-100',
                      }),
                    ]
                  },
                }),
              ]),

              g({ ...parts.layer }, [
                each(parts.categoryTicks, {
                  key: (t: chartC.ChartCategoryTick) => String(t.index),
                  render: (t: Signal<chartC.ChartCategoryTick>) => [
                    svgText(
                      {
                        ...parts.axisLabel,
                        x: t.at('x'),
                        y: t.at('y'),
                        dy: t.map((v) => (v.baseline === 'hanging' ? 6 : 0)),
                        dx: t.map((v) => (v.anchor === 'end' ? -6 : 0)),
                        'text-anchor': t.at('anchor'),
                        'dominant-baseline': t.at('baseline'),
                        'data-active': t.map((v) => (v.active ? '' : undefined)),
                        class:
                          'fill-muted-foreground text-[10px] data-active:fill-foreground data-active:font-medium',
                      },
                      [text(t.at('label'))],
                    ),
                  ],
                }),
                each(parts.gridLines, {
                  key: (l: chartC.ChartGridLine) => `v${l.value}`,
                  render: (l: Signal<chartC.ChartGridLine>) => [
                    svgText(
                      {
                        ...parts.axisLabel,
                        x: l.at('x'),
                        y: l.at('y'),
                        dx: l.map((v) => (v.anchor === 'end' ? -6 : 0)),
                        'text-anchor': l.at('anchor'),
                        'dominant-baseline': l.at('baseline'),
                        class: 'fill-muted-foreground text-[10px]',
                      },
                      [text(l.at('label'))],
                    ),
                  ],
                }),
              ]),
            ],
          ),

          // Positioned against the CONTAINER, in viewBox percentages, so it tracks
          // its mark at any CSS size without a second measurement. It is also the
          // `role="status"` live region that announces the keyboard cursor — there
          // is no `aria-activedescendant`, which is invalid on `role="img"`.
          div(
            {
              ...parts.tooltip,
              class:
                'pointer-events-none absolute z-10 grid min-w-[8rem] -translate-x-1/2 -translate-y-[calc(100%+8px)] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-lg',
            },
            [
              div({ class: 'font-medium' }, [text(parts.activeLabel)]),
              // The wrapper exists to carry ONE reactive read that must not happen
              // inside the `each` — see `tooltipSwatchOf`. A custom property
              // inherits, so the swatch picks it up with no prop threaded through.
              div(
                {
                  class: 'grid gap-1.5',
                  style: state.map((s) =>
                    activeColor === null ? '' : `--tooltip-color:${activeColor(s)}`,
                  ),
                },
                [
                  each(parts.tooltipRows, {
                    key: (r: chartC.ChartTooltipRow) => r.seriesKey,
                    render: (r: Signal<chartC.ChartTooltipRow>) => {
                      // Snapshotted where the compiler can see it: the row KEY is
                      // the series, so a row's own colour cannot change without the
                      // row being rebuilt.
                      const swatch = opts.tooltipSwatchOf(r.peek())
                      return [
                        div({ class: 'flex w-full flex-wrap items-stretch gap-2' }, [
                          span({
                            style: `--mark-color:${swatch}`,
                            class: 'size-2.5 shrink-0 self-center rounded-[2px] bg-(--mark-color)',
                          }),
                          span({ class: 'text-muted-foreground' }, [text(r.at('label'))]),
                          span(
                            { class: 'ml-auto font-mono font-medium tabular-nums text-foreground' },
                            [
                              text(
                                r.map((v) =>
                                  v.share === null
                                    ? String(v.value)
                                    : `${v.value} (${Math.round(v.share * 100)}%)`,
                                ),
                              ),
                            ],
                          ),
                        ]),
                      ]
                    },
                  }),
                ],
              ),
            ],
          ),
        ],
      ),

      div(
        { class: 'flex flex-wrap items-center justify-center gap-4 pt-3' },
        opts.legend === null
          ? Object.keys(SERIES_COLOR).map((key) =>
              button(
                {
                  ...parts.legendItem(key),
                  class:
                    'flex cursor-pointer items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-opacity data-dimmed:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                },
                [
                  span({
                    style: `--mark-color:${SERIES_COLOR[key]}`,
                    class: 'size-2 shrink-0 rounded-[2px] bg-(--mark-color)',
                  }),
                  text(key === 'desktop' ? 'Desktop' : 'Mobile'),
                ],
              ),
            )
          : opts.legend.map((entry) =>
              // No `legendItem` bag here: it isolates a SERIES, and a pie has
              // one. Swatch and label only, so the legend states what the
              // colours mean without offering an interaction that cannot work.
              span({ class: 'flex items-center gap-1.5 text-xs text-muted-foreground' }, [
                span({
                  style: `--mark-color:${entry.color}`,
                  class: 'size-2 shrink-0 rounded-[2px] bg-(--mark-color)',
                }),
                text(entry.label),
              ]),
            ),
      ),

      // The real screen-reader path: `role="img"` names the chart, THIS carries
      // its numbers. `sr-only` rather than `hidden` — `hidden` would remove it
      // from the accessibility tree, which is exactly the audience it exists
      // for. The demo can reveal it to check that it says the same thing.
      table(
        {
          ...parts.table,
          class: showTable.map((show) =>
            show ? 'mt-3 w-full text-left text-xs text-muted-foreground' : 'sr-only',
          ),
        },
        [
          thead([
            tr([
              th({ scope: 'col', class: 'pr-3 font-medium' }, [text(opts.rowHeading)]),
              ...opts.columns.map((c) =>
                th({ scope: 'col', class: 'pr-3 font-medium' }, [text(c.label)]),
              ),
            ]),
          ]),
          tbody([
            each(parts.rows, {
              key: (r: chartC.ChartRow) => r.label,
              render: (r: Signal<chartC.ChartRow>) => [
                tr([
                  th({ scope: 'row', class: 'pr-3 font-normal' }, [text(r.at('label'))]),
                  ...opts.columns.map((c) =>
                    td({ class: 'pr-3 tabular-nums' }, [text(r.map(c.cell))]),
                  ),
                ]),
              ],
            }),
          ]),
        ],
      ),
    ],
  )
}

const seriesOptions = (id: string): PlotOptions => ({
  id,
  colorOf: (m) => SERIES_COLOR[m.seriesKey] ?? 'var(--chart-1)',
  tooltipSwatchOf: (r) => SERIES_COLOR[r.seriesKey] ?? 'var(--chart-1)',
  tooltipActiveColorOf: null,
  legend: null,
  rowHeading: 'Month',
  columns: [
    { label: 'Desktop', cell: (row) => String(row.values.desktop ?? 0) },
    { label: 'Mobile', cell: (row) => String(row.values.mobile ?? 0) },
  ],
})

const BROWSER_TOTAL = BROWSERS.reduce((sum, r) => sum + (r.values.visitors ?? 0), 0)

const shareOptions = (id: string): PlotOptions => ({
  id,
  // The mark's ROW index picks the colour: one series, one slice per row.
  colorOf: (m) => BROWSER_COLORS[m.index ?? 0] ?? BROWSER_COLORS[0]!,
  // One series, so one tooltip row — its colour is the ACTIVE ROW's, published
  // on the wrapper outside the `each` and read back through the variable.
  tooltipSwatchOf: () => 'var(--tooltip-color)',
  tooltipActiveColorOf: (s) => BROWSER_COLORS[s.activeIndex ?? 0] ?? BROWSER_COLORS[0]!,
  legend: BROWSERS.map((r, i) => ({
    label: r.label,
    color: BROWSER_COLORS[i] ?? BROWSER_COLORS[0]!,
  })),
  rowHeading: 'Browser',
  columns: [
    { label: 'Visitors', cell: (row) => String(row.values.visitors ?? 0) },
    {
      label: 'Share',
      cell: (row) => `${Math.round(((row.values.visitors ?? 0) / BROWSER_TOTAL) * 100)}%`,
    },
  ],
})

// ── Controls ──────────────────────────────────────────────────────────────

function controlRow(label: string, children: Renderable): Mountable {
  const nodes: Mountable[] = [
    span({ class: 'mr-1 text-xs font-medium text-muted-foreground' }, [text(label)]),
  ]
  for (const node of children) nodes.push(node)
  return div({ class: 'mt-3 flex flex-wrap items-center gap-2' }, nodes)
}

/**
 * A control whose PRESSED state is the chart's own state read back.
 *
 * The class is switched between two whole `.btn` recipes rather than layering a
 * utility on top: the baseline stylesheet's `.btn-*` rules are UNLAYERED, so a
 * `@layer utilities` background would lose to them with nothing to show for it.
 */
function toggle(label: string, on: Signal<boolean>, onClick: () => void): Mountable {
  return button(
    {
      type: 'button',
      'aria-pressed': on,
      class: on.map((v) => (v ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm')),
      onClick,
    },
    [text(label)],
  )
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const trafficSend = (m: chartC.ChartMsg): void => send({ type: 'traffic', msg: m })
  const trendSend = (m: chartC.ChartMsg): void => send({ type: 'trend', msg: m })
  const shareSend = (m: chartC.ChartMsg): void => send({ type: 'share', msg: m })
  const showTable = state.at('showTable')

  /**
   * The projection switch. The viewBox is STATE, so the consumer picks the box
   * that suits the projection — a wide one for a plot, a square for a circle.
   * Nothing in the machine forces it: `frameOf` centres on `min(w, h)` either
   * way, it just leaves gutters in a box that does not match.
   */
  const coordRow = (slice: Signal<chartC.ChartState>, to: Send<chartC.ChartMsg>): Mountable =>
    controlRow('Projection', [
      toggle(
        'Cartesian',
        slice.map((s) => s.coord === 'cartesian'),
        () => {
          to({ type: 'setCoord', coord: 'cartesian' })
          to({ type: 'setSize', ...CARTESIAN_BOX })
        },
      ),
      toggle(
        'Polar',
        slice.map((s) => s.coord === 'polar'),
        () => {
          to({ type: 'setCoord', coord: 'polar' })
          to({ type: 'setSize', ...POLAR_BOX })
        },
      ),
    ])

  return [
    sectionGroup('Charts', [
      card('Chart — bars, and the `coord` switch', [
        p({ class: 'mb-3 text-xs text-muted-foreground' }, [
          text(
            'One state field decides everything. Switching to polar turns every bar into a ' +
              'wedge, every value gridline into a ring and the hit test from "nearest x" into ' +
              '"nearest angle" — with no change to the view, the series or the data. Click a ' +
              'legend entry to isolate a series: the hidden series keeps its slot inside each ' +
              'band, so nothing moves.',
          ),
        ]),
        plot(state.at('traffic'), trafficSend, showTable, seriesOptions('demo-traffic')),
        coordRow(state.at('traffic'), trafficSend),
        controlRow('Layout', [
          toggle(
            'Stacked',
            state.at('traffic').map((s) => s.stacked),
            () =>
              trafficSend({
                type: 'setStacked',
                stacked: !state.at('traffic').peek().stacked,
              }),
          ),
          // `horizontal` reads as "the independent axis moves off its default
          // screen axis", so it means something in BOTH projections: horizontal
          // bars in cartesian, and bars running along the RADIUS in polar.
          toggle(
            'Horizontal',
            state.at('traffic').map((s) => s.horizontal),
            () =>
              trafficSend({
                type: 'setHorizontal',
                horizontal: !state.at('traffic').peek().horizontal,
              }),
          ),
          // Labelled with the projection it applies to: `innerRadius` is polar
          // only, and a control that visibly does nothing in the other half
          // reads as a broken control rather than an inapplicable one.
          toggle(
            'Donut hole (polar)',
            state.at('traffic').map((s) => s.innerRadius > 0),
            () =>
              trafficSend({
                type: 'setInnerRadius',
                value: state.at('traffic').peek().innerRadius > 0 ? 0 : 0.3,
              }),
          ),
        ]),
        p({ class: 'mt-2 text-xs text-muted-foreground' }, [
          text(
            'Focus the plot and use the arrow keys — Home/End jump to the ends, Escape clears. ' +
              'In polar the independent axis runs AROUND, so both arrow pairs advance it.',
          ),
        ]),
      ]),

      card('Chart — lines, areas and the curves polar declines', [
        p({ class: 'mb-3 text-xs text-muted-foreground' }, [
          text(
            'The same seam: a monotone area and a line become a filled radar polygon and a ' +
              'radar outline. `monotone` and `step` are functions of the INDEPENDENT axis and ' +
              'are defined on an increasing one, which a closed angular loop does not have — so ' +
              'the polar projection DECLINES them and draws `linear` rather than approximating ' +
              'values nobody measured. `Projection.curves` states the supported set, so the ' +
              'limit is introspectable instead of silent.',
          ),
        ]),
        plot(state.at('trend'), trendSend, showTable, seriesOptions('demo-trend')),
        coordRow(state.at('trend'), trendSend),
        controlRow('Curve', [
          ...(['linear', 'monotone', 'step'] as const).map((curve) =>
            toggle(
              curve,
              state.at('trend').map((s) => (s.series[0]?.curve ?? 'linear') === curve),
              () => send({ type: 'setCurve', curve }),
            ),
          ),
        ]),
        p({ class: 'mt-2 font-mono text-xs text-muted-foreground' }, [
          text(
            state
              .at('trend')
              .map(
                (s) =>
                  `requested: ${s.series[0]?.curve ?? 'linear'} · ` +
                  `${s.coord} honours: ${chartC.geometry(s).projection.curves.join(', ')}`,
              ),
          ),
        ]),
      ]),

      card('Chart — share domain: pie, donut, 100% bar', [
        p({ class: 'mb-3 text-xs text-muted-foreground' }, [
          text(
            'There is no `pie` mark. `domain: "share"` allocates the independent axis in ' +
              'PROPORTION to each value instead of in equal slots, which moves the magnitude ' +
              "from a bar's height onto a slice's extent — and that is the whole of a pie. So " +
              'the same state is a donut in polar and one full-width 100%-share bar in ' +
              'cartesian. Three things are declined rather than approximated: a share axis ' +
              'takes NO band padding (a gap would make every slice misstate its share, and a ' +
              'full turn stop being 100%), a NEGATIVE value takes no arc, and `line`/`area` are ' +
              'not drawn at all.',
          ),
        ]),
        plot(state.at('share'), shareSend, showTable, shareOptions('demo-share')),
        controlRow('Shape', [
          toggle(
            'Pie',
            state
              .at('share')
              .map((s) => s.domain === 'share' && s.coord === 'polar' && s.innerRadius === 0),
            () => {
              shareSend({ type: 'setDomain', domain: 'share' })
              shareSend({ type: 'setCoord', coord: 'polar' })
              shareSend({ type: 'setHorizontal', horizontal: false })
              shareSend({ type: 'setInnerRadius', value: 0 })
              shareSend({ type: 'setSize', ...POLAR_BOX })
            },
          ),
          toggle(
            'Donut',
            state
              .at('share')
              .map((s) => s.domain === 'share' && s.coord === 'polar' && s.innerRadius > 0),
            () => {
              shareSend({ type: 'setDomain', domain: 'share' })
              shareSend({ type: 'setCoord', coord: 'polar' })
              shareSend({ type: 'setHorizontal', horizontal: false })
              shareSend({ type: 'setInnerRadius', value: 0.5 })
              shareSend({ type: 'setSize', ...POLAR_BOX })
            },
          ),
          toggle(
            '100% bar',
            state
              .at('share')
              .map((s) => s.domain === 'share' && s.coord === 'cartesian' && !s.horizontal),
            () => {
              // The SAME data and the same domain, re-projected. `horizontal`
              // stays FALSE: under a share domain the slice extents are the
              // INDEPENDENT axis, so leaving it off runs them left-to-right
              // across one full-height bar — which is what a pie unrolls into.
              shareSend({ type: 'setDomain', domain: 'share' })
              shareSend({ type: 'setCoord', coord: 'cartesian' })
              shareSend({ type: 'setHorizontal', horizontal: false })
              shareSend({ type: 'setSize', width: 640, height: 120 })
            },
          ),
          toggle(
            'Stacked stripes',
            state
              .at('share')
              .map((s) => s.domain === 'share' && s.coord === 'cartesian' && s.horizontal),
            () => {
              // `horizontal` under a share domain is a DIFFERENT chart, not a
              // rotation of the same one: the stripes stack vertically with
              // their HEIGHTS proportional. Honest, but not what a pie unrolls
              // into — which is why both are shown.
              shareSend({ type: 'setDomain', domain: 'share' })
              shareSend({ type: 'setCoord', coord: 'cartesian' })
              shareSend({ type: 'setHorizontal', horizontal: true })
              shareSend({ type: 'setSize', width: 320, height: 320 })
            },
          ),
          toggle(
            'Radial bars',
            state.at('share').map((s) => s.domain === 'value'),
            () => {
              // Back to a VALUE domain: arc length states the magnitude again,
              // so the slots are equal and the value axis returns. `horizontal`
              // in polar reads as "the independent axis moves off the angle,
              // onto the radius".
              shareSend({ type: 'setDomain', domain: 'value' })
              shareSend({ type: 'setCoord', coord: 'polar' })
              shareSend({ type: 'setHorizontal', horizontal: true })
              shareSend({ type: 'setInnerRadius', value: 0.2 })
              shareSend({ type: 'setSize', ...POLAR_BOX })
            },
          ),
        ]),
      ]),

      card('Chart — the accessible surface', [
        p({ class: 'mb-3 text-xs text-muted-foreground' }, [
          text(
            'Accessibility here is a real `<table>`, not the WAI-ARIA graphics roles: support ' +
              'for those is still thin enough that a chart relying on them announces a name and ' +
              'nothing else. Each `<svg>` is `role="img"` named through its own `<title>` and ' +
              '`<desc>`, and every chart above already renders the same rows as a ' +
              'visually-hidden table. Reveal them to check the numbers match the picture. The ' +
              'keyboard cursor is announced through the tooltip, which is a `role="status"` ' +
              'live region — `aria-activedescendant` is invalid on `role="img"`.',
          ),
        ]),
        controlRow('Fallback', [
          toggle('Show the data tables', showTable, () => send({ type: 'toggleTable' })),
        ]),
      ]),
    ]),
  ]
}
