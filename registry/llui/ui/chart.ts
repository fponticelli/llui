import {
  button,
  circle,
  div,
  g,
  path,
  svg,
  svgText,
  svgTitle,
  svgDesc,
  table,
  tbody,
  td,
  th,
  thead,
  tr,
  span,
  type ElementHelper,
} from '@llui/dom'
import { classPart } from '@/lib/utils'

/**
 * Ported from shadcn/ui (MIT © 2023 shadcn), with `data-slot` rewritten to
 * LLui's `data-part`.
 *
 * # What was portable and what was not
 *
 * Upstream's `chart.tsx` is a **Recharts** wrapper. Two of its three parts port
 * cleanly and one cannot:
 *
 * - **The theming bridge ports.** A `ChartConfig` maps each series key to a
 *   label and a colour, and the container publishes them as `--color-<key>`
 *   custom properties. That is the piece that makes a chart match the app's
 *   theme in light and dark, and it is pure CSS. {@link chartVars} is it.
 * - **The tooltip and legend recipes port verbatim.** They are ordinary
 *   surfaces and need no charting library at all.
 * - **The drawing does NOT port.** Recharts is React-only. The marks below are
 *   `@llui/components/chart`'s derived geometry rendered as ordinary SVG — see
 *   that module for why a machine, and `utils/projection.ts` for how one set of
 *   marks serves both cartesian and polar.
 *
 * Upstream's container also carries a block of `[&_.recharts-*]` selectors
 * targeting Recharts' own class names. Those are dropped for the same reason
 * `command` drops `cmdk`'s: there is no Recharts here. Their INTENT — muted
 * axis text, muted grid strokes, no outline on the plot — is expressed against
 * `data-part` instead, which is the same `data-slot` → `data-part` translation
 * applied one level down.
 *
 * ```ts
 * import * as chartC from '@llui/components/chart'
 *
 * const parts = chartC.connect(state.at('chart'), chartSend, { id: 'visitors' })
 *
 * ChartContainer({ config: { desktop: { label: 'Desktop', color: 'var(--chart-1)' } } }, [
 *   ChartSvg({ ...parts.svg }, [
 *     ChartTitle({ ...parts.title }, [text('Visitors')]),
 *     ChartDesc({ ...parts.desc }, [text('Last six months')]),
 *     each(parts.gridLines, { key: (l) => String(l.value), render: … }),
 *     each(parts.marks, { key: (m) => `${m.seriesKey}:${m.index}`, render: … }),
 *   ]),
 *   ChartTooltipContent({ ...parts.tooltip }, [...]),
 *   ChartTable({ ...parts.table }, [...]),
 * ])
 * ```
 */

/** One series' presentation. `color` accepts any CSS colour — a theme token
 *  (`var(--chart-1)`) keeps it in step with light/dark for free. */
export interface ChartSeriesConfig {
  label: string
  color: string
}

export type ChartConfig = Record<string, ChartSeriesConfig>

/**
 * The `--color-<key>` bridge — the genuinely portable half of upstream's
 * `ChartStyle`.
 *
 * shadcn injects a `<style>` tag scoped by a generated `data-chart` id. Inline
 * custom properties on the container do the same job with no id to generate, no
 * stylesheet to inject and no chance of two charts colliding: a custom property
 * inherits, so every mark inside can read `var(--color-desktop)` — including
 * from a class recipe, which is what keeps the colours out of the view.
 */
export function chartVars(config: ChartConfig): string {
  return Object.entries(config)
    .map(([key, series]) => `--color-${key}:${series.color}`)
    .join(';')
}

/**
 * The plot container. `aspect-video` and the `text-xs` baseline are upstream's;
 * the descendant rules replace upstream's `[&_.recharts-*]` block, and the
 * `data-coord` rule lets a polar chart claim a square box while a cartesian one
 * keeps the wide default.
 *
 * The `ChartConfig` is passed as `style: chartVars(config)` rather than as a
 * prop of its own. `ElProps`'s index signature admits only attribute values and
 * handlers, so intersecting a `config?: ChartConfig` onto it collapses that key
 * to `undefined` and every call site fails to type-check — the same reason
 * `mergeClass` takes its override as `unknown`.
 */
export const ChartContainer = classPart(
  div,
  "relative flex aspect-video w-full flex-col justify-center text-xs data-[coord=polar]:aspect-square data-[coord=polar]:max-h-[420px] [&_[data-part='svg']]:outline-none [&_[data-part='grid']]:stroke-border/50 [&_[data-part='axis-label']]:fill-muted-foreground",
)

/** The `<svg>`. `overflow-visible` matters: polar tick labels sit OUTSIDE the
 *  plot radius by design, and the default clip would cut every one of them. */
export const ChartSvg = classPart(
  svg,
  'min-h-0 w-full flex-1 overflow-visible focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md',
)

/**
 * SVG `<title>` and `<desc>` — what `parts.svg`'s `aria-labelledby` points at,
 * and therefore what a screen reader announces for the whole chart. Neither
 * renders visually and neither needs a class; both must be the FIRST children
 * of the `<svg>`, because an assistive technology that does not resolve the
 * reference falls back to the first `<title>` it finds.
 */
export const ChartTitle: ElementHelper = svgTitle
export const ChartDesc: ElementHelper = svgDesc

// ── Marks ─────────────────────────────────────────────────────────────────

/**
 * One drawn mark. `data-mark` selects the stroke/fill treatment, and the colour
 * comes from the `--color-<key>` the container published — so a series changes
 * colour by changing the config, never the view.
 *
 * `data-dimmed` is the legend's isolation state; `data-active` is the row under
 * the cursor. Both are bare attributes, matching every boolean `data-*` in
 * `@llui/components`.
 */
export const ChartMark = classPart(
  path,
  'transition-opacity data-dimmed:opacity-25 data-[mark=bar]:fill-(--mark-color) data-[mark=area]:fill-(--mark-color) data-[mark=area]:opacity-70 data-[mark=line]:fill-none data-[mark=line]:stroke-(--mark-color) data-[mark=line]:stroke-2 data-[mark=line]:[stroke-linecap:round] data-[mark=line]:[stroke-linejoin:round] data-active:opacity-100',
)

/** A vertex dot on a line or area series. Hidden until its row is active, which
 *  is what makes the keyboard cursor visible without a permanent dot layer. */
export const ChartDot = classPart(
  circle,
  'fill-(--mark-color) stroke-background stroke-2 opacity-0 transition-opacity data-active:opacity-100',
)

/** The value gridlines. */
export const ChartGrid = classPart(path, 'fill-none stroke-border/50 stroke-1')

/** An axis label — category names and value ticks. */
export const ChartAxisLabel = classPart(
  svgText,
  'fill-muted-foreground text-[10px] data-active:fill-foreground data-active:font-medium',
)

/** A `<g>` layer, so marks / dots / labels stack in a defined order. */
export const ChartLayer = classPart(g, '')

// ── Tooltip (ported verbatim) ─────────────────────────────────────────────

/**
 * Positioned by the machine, which publishes `left`/`top` as PERCENTAGES of the
 * viewBox — so it tracks its mark at any CSS size with no second measurement.
 * `-translate-x-1/2 -translate-y-full` puts it above the point rather than on it.
 */
export const ChartTooltipContent = classPart(
  div,
  'pointer-events-none absolute z-10 grid min-w-[8rem] -translate-x-1/2 -translate-y-[calc(100%+8px)] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
)

export const ChartTooltipLabel = classPart(div, 'font-medium')

export const ChartTooltipItem = classPart(
  div,
  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
)

/** The colour chip. `--mark-color` is set per row by the view from the series
 *  key, exactly as the marks do. */
export const ChartTooltipIndicator = classPart(
  span,
  'shrink-0 rounded-[2px] size-2.5 self-center bg-(--mark-color)',
)

export const ChartTooltipName = classPart(span, 'text-muted-foreground')

export const ChartTooltipValue = classPart(
  span,
  'ml-auto font-mono font-medium tabular-nums text-foreground',
)

// ── Legend (ported verbatim) ──────────────────────────────────────────────

export const ChartLegend = classPart(div, 'flex items-center justify-center gap-4 pt-3')

/** A `<button>`, not a div: `parts.legendItem(key)` spreads `type="button"` and
 *  `aria-pressed`, and isolating a series must be reachable from the keyboard. */
export const ChartLegendItem = classPart(
  button,
  'flex cursor-pointer items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-xs text-muted-foreground transition-opacity data-dimmed:opacity-40 [&>svg]:h-3 [&>svg]:w-3',
)

export const ChartLegendSwatch = classPart(span, 'size-2 shrink-0 rounded-[2px] bg-(--mark-color)')

// ── Accessible fallback ───────────────────────────────────────────────────

/**
 * The visually-hidden data table, and the reason `ChartSvg` can settle for
 * `role="img"`.
 *
 * A chart that is only an `<svg>` is unreadable: AT support for the WAI-ARIA
 * graphics roles is still thin enough that a chart relying on them alone
 * announces a name and nothing else. A real `<table>` of the same rows is the
 * one fallback that works everywhere today, and it costs nothing visually.
 *
 * `sr-only` rather than `hidden` — `hidden` removes it from the accessibility
 * tree, which is exactly the audience it exists for.
 */
export const ChartTable = classPart(table, 'sr-only')
export const ChartTableHead = classPart(thead, '')
export const ChartTableBody = classPart(tbody, '')
export const ChartTableRow = classPart(tr, '')
export const ChartTableHeader = classPart(th, '')
export const ChartTableCell = classPart(td, '')
