import {
  circle,
  div,
  g,
  path,
  span,
  svg,
  svgDesc,
  svgTitle,
  table,
  tbody,
  td,
  th,
  thead,
  tr,
  type ElementHelper,
} from '@llui/dom'
import { classPart, classPartWithDefaults } from '../../lib/utils'

/**
 * Skin for `@llui/components/sparkline`.
 *
 * There is NO shadcn counterpart to port: upstream's `chart.tsx` is a Recharts
 * wrapper and Recharts has no sparkline. So unlike the 45 items with an
 * upstream twin, this one is not a verbatim port and cannot be measured against
 * one. What it does instead is reuse `chart.ts`'s vocabulary wherever the two
 * draw the same thing — `stroke-border/50` gridlines, a `fill-muted-foreground`
 * axis, the `pointer-events-none absolute` tooltip, the `sr-only` table — so a
 * page carrying both reads as one system rather than two.
 *
 * # An unstyled SVG part is worse than an unstyled div
 *
 * A `<path>` defaults to `fill: black; stroke: none`. A trend line with no
 * recipe is therefore a solid black blob, not an invisible one — which is why
 * every drawn part below states both properties and the line states `fill-none`
 * first. The same trap is why `SparklineDot` carries a default `r` attribute:
 * a `<circle>` with no radius draws nothing at all, and Tailwind has no `r-*`
 * utility to supply one.
 *
 * ```ts
 * import * as sparklineC from '@llui/components/sparkline'
 *
 * const parts = sparklineC.connect(state.at('trend'), send, { id: 'systolic' })
 *
 * Sparkline({ ...parts.root }, [
 *   SparklineSvg({ ...parts.svg }, [
 *     SparklineTitle({ ...parts.title }, [text('Systolic')]),
 *     SparklineDesc({ ...parts.desc }, [text('Against 90–120')]),
 *     SparklineBand({ ...parts.band }),
 *     SparklineLayer({ ...parts.layer }, [
 *       each(parts.ticks, { key: (t) => t.key, render: (t) => [SparklineGrid(parts.tickProps(t))] }),
 *     ]),
 *     SparklineLine({ ...parts.line }),
 *     SparklineNow({ ...parts.now }),
 *   ]),
 *   SparklineTooltip({ ...parts.tooltip }, [...]),
 *   SparklineTable({ ...parts.table }, [...]),
 * ])
 * ```
 */

/**
 * The container. `relative` because the tooltip positions itself against it
 * with the percentages the machine publishes, and `inline-block` because a
 * sparkline's whole purpose is to sit beside a reading in a table cell.
 *
 * `leading-none` kills the line-box descender an inline `<svg>` otherwise
 * reserves under itself, which is what makes a cell-sized trend sit a few
 * pixels above its own baseline.
 */
export const Sparkline = classPart(div, 'relative inline-block leading-none align-middle')

/** The `<svg>`. `overflow-visible` matters for the same reason it does on a
 *  chart: the granularity track sits in the bottom padding and a dot on the
 *  right edge is half outside the box. */
export const SparklineSvg = classPart(
  svg,
  'block h-8 w-30 overflow-visible focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm',
)

/** `<title>` / `<desc>` — what `parts.svg`'s `aria-labelledby` points at.
 *  Neither renders, and both must be the FIRST children of the `<svg>`. */
export const SparklineTitle: ElementHelper = svgTitle
export const SparklineDesc: ElementHelper = svgDesc

/**
 * The reference band, drawn BEHIND everything. One recipe for all three
 * readings — the machine has already turned "high only" into a rect from the
 * axis floor to the high bound, so the skin never branches on `data-band`.
 */
export const SparklineBand = classPart(path, 'fill-primary/15 stroke-none')

/** A calendar gridline. Same treatment as `ChartGrid`, so a sparkline beside a
 *  chart shares its axis furniture. */
export const SparklineGrid = classPart(path, 'fill-none stroke-border/50 stroke-1')

/**
 * The right edge — "now". Hidden until the series is actually behind it: a
 * rule drawn under the last reading would claim a staleness the data does not
 * have, so the visible state is gated on the bare `data-stale` the machine
 * publishes.
 */
export const SparklineNow = classPart(
  path,
  'fill-none stroke-border stroke-1 [stroke-dasharray:2_2] opacity-0 data-stale:opacity-100',
)

/** The trend line. `fill-none` FIRST — see the module note. */
export const SparklineLine = classPart(
  path,
  'fill-none stroke-primary stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]',
)

/**
 * One reading, coloured by its tone.
 *
 * Both out-of-band tones take `destructive`, and they are told apart by FILL
 * rather than by hue — the low side is hollow. There is no theme token meaning
 * "too low" as against "too high", so picking a second semantic colour would be
 * asserting a direction the theme never declared; a consumer whose domain has
 * one overrides `data-[tone=below]` and gets it.
 *
 * `r` is a DEFAULT ATTRIBUTE, not a class: Tailwind has no `r-*` utility, and a
 * `<circle>` with no radius draws nothing. `data-last:r-*` is likewise not a
 * thing, so the last reading is emphasised with a ring instead of a radius.
 */
export const SparklineDot = classPartWithDefaults(
  circle,
  'fill-primary stroke-none data-[tone=none]:fill-muted-foreground data-[tone=above]:fill-destructive data-[tone=below]:fill-background data-[tone=below]:stroke-destructive data-[tone=below]:stroke-1 data-last:stroke-background data-last:stroke-2 data-[tone=below]:data-last:stroke-destructive',
  { r: 2 },
)

/**
 * One stretch of the granularity track. `data-grain` is free-form — the machine
 * never interprets it — so the recipe styles the band and a consumer keys off
 * their own vocabulary for the rest.
 */
export const SparklineSpan = classPart(path, 'fill-muted-foreground/40 stroke-none')

/** A `<g>` layer, so band / grid / track / line / dots stack in a defined
 *  order. */
export const SparklineLayer = classPart(g, '')

/** Positioned by the machine, which publishes `left`/`top` as PERCENTAGES of
 *  the viewBox — so it tracks its dot at any CSS size with no second
 *  measurement. Same recipe family as `ChartTooltipContent`, one size down. */
export const SparklineTooltip = classPart(
  div,
  'pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-md border border-border/50 bg-background px-1.5 py-0.5 text-xs shadow-md',
)

export const SparklineTooltipValue = classPart(
  span,
  'font-mono font-medium tabular-nums text-foreground',
)

export const SparklineTooltipDate = classPart(span, 'ml-1.5 text-muted-foreground')

/**
 * The visually-hidden data table, and the reason `SparklineSvg` can settle for
 * `role="img"`. An SVG polyline announces nothing; a real `<table>` of the same
 * rows works everywhere and costs nothing visually.
 *
 * `sr-only` rather than `hidden` — `hidden` removes it from the accessibility
 * tree, which is precisely the audience it exists for.
 */
export const SparklineTable = classPart(table, 'sr-only')
export const SparklineTableHead = classPart(thead, '')
export const SparklineTableBody = classPart(tbody, '')
export const SparklineTableRow = classPart(tr, '')
export const SparklineTableHeader = classPart(th, '')
export const SparklineTableCell = classPart(td, '')
