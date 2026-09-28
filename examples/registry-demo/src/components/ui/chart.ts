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
import { classPart } from '../../lib/utils'

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
 * The `data-domain` rule is what makes a pie readable. Under a SHARE domain the
 * wedges tile the whole circle with no gaps — they have to, or each one would
 * misstate its share — so two adjacent slices of similar colour meet on an
 * invisible seam. A background-coloured stroke separates them without taking
 * any angle away from either, which is exactly what shadcn's own `<Pie>` does
 * (`stroke` on the series). It is scoped to `share` because a column chart gets
 * its separation from the band padding and does not want the outline.
 *
 * The `ChartConfig` is passed as `style: chartVars(config)` rather than as a
 * prop of its own. `ElProps`'s index signature admits only attribute values and
 * handlers, so intersecting a `config?: ChartConfig` onto it collapses that key
 * to `undefined` and every call site fails to type-check — the same reason
 * `mergeClass` takes its override as `unknown`.
 */
export const ChartContainer = classPart(
  div,
  "relative flex aspect-video w-full flex-col justify-center text-xs data-[coord=polar]:aspect-square data-[coord=polar]:max-h-[420px] [&_[data-part='svg']]:outline-none [&_[data-part='grid']]:stroke-border/50 [&_[data-part='axis-label']]:fill-muted-foreground data-[domain=share]:[&_[data-part='mark']]:stroke-background data-[domain=share]:[&_[data-part='mark']]:stroke-2",
)

/** The `<svg>`. `overflow-visible` matters: polar tick labels sit OUTSIDE the
 *  plot radius by design, and the default clip would cut every one of them. */
export const ChartSvg = classPart(
  svg,
  'min-h-0 w-full flex-1 overflow-visible focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-md [forced-color-adjust:none] forced-colors:bg-[Canvas]',
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
/**
 * `forced-colors:fill-[CanvasText]!` alone (main, pre-#264) made every
 * bar/area series identical under forced colors — a dash pattern on `stroke`
 * (below) does nothing for a FILLED shape's fill. The eight
 * `data-[mark=…]:data-[series-cue=…]:fill-(--llui-chart-fill-…)!` rules read
 * five CSS custom properties, defaulted once in `tailwind.css`'s `:root` but
 * overridden PER CHART INSTANCE by `connect()` itself (a fixed, shared
 * pattern id resolves a `url(#...)` reference to whichever same-named
 * element the browser's id table returns, so a hidden chart earlier on the
 * page can blank every other chart's fill — #264 review item 3), each an SVG
 * `url('#<id>:pattern-…') CanvasText` reference into the `<pattern>` ids
 * `chartForcedColorPatterns(id)` (from `@llui/components/chart`, given the
 * SAME `id` as `connect()`) defines — place it once as the first child of
 * `parts.svg`. The pattern reference lives in a custom property, not inline
 * as `fill-[url('#…')]`, because
 * Tailwind v4's content scanner does not reliably candidate-detect an
 * arbitrary value containing an unescaped `#` inside a long chained-variant
 * utility (measured: the whole utility silently dropped from the compiled
 * output). `fill-(--name)` needs no bracket-content scanning at all — see
 * `tailwind.css`'s own comment on these properties for the full story.
 * `data-series-cue=solid` keeps the flat `CanvasText` fill (no override
 * needed for it, matching the base fallback), so only four override pairs
 * are declared per mark type.
 */
export const ChartMark = classPart(
  path,
  'transition-opacity data-dimmed:opacity-25 data-[mark=bar]:fill-(--mark-color) data-[mark=area]:fill-(--mark-color) data-[mark=area]:opacity-70 data-[mark=line]:fill-none data-[mark=line]:stroke-(--mark-color) data-[mark=line]:stroke-2 data-[mark=line]:[stroke-linecap:round] data-[mark=line]:[stroke-linejoin:round] data-active:opacity-100 motion-reduce:transition-none forced-colors:opacity-100! forced-colors:fill-[CanvasText]! forced-colors:stroke-[CanvasText]! forced-colors:stroke-2 forced-colors:data-[mark=line]:fill-none! forced-colors:data-[series-cue=solid]:[stroke-dasharray:none] forced-colors:data-[series-cue=short-dash]:[stroke-dasharray:8_3] forced-colors:data-[series-cue=dot]:[stroke-dasharray:2_3] forced-colors:data-[series-cue=long-dash]:[stroke-dasharray:14_4] forced-colors:data-[series-cue=dash-dot]:[stroke-dasharray:10_3_2_3] forced-colors:data-[series-cue=grid]:[stroke-dasharray:3_3_1_3] forced-colors:data-[series-cue=cross-hatch]:[stroke-dasharray:1_2_4_2] forced-colors:data-[mark=bar]:data-[series-cue=short-dash]:fill-(--llui-chart-fill-short-dash)! forced-colors:data-[mark=bar]:data-[series-cue=dot]:fill-(--llui-chart-fill-dot)! forced-colors:data-[mark=bar]:data-[series-cue=long-dash]:fill-(--llui-chart-fill-long-dash)! forced-colors:data-[mark=bar]:data-[series-cue=dash-dot]:fill-(--llui-chart-fill-dash-dot)! forced-colors:data-[mark=bar]:data-[series-cue=grid]:fill-(--llui-chart-fill-grid)! forced-colors:data-[mark=bar]:data-[series-cue=cross-hatch]:fill-(--llui-chart-fill-cross-hatch)! forced-colors:data-[mark=area]:data-[series-cue=short-dash]:fill-(--llui-chart-fill-short-dash)! forced-colors:data-[mark=area]:data-[series-cue=dot]:fill-(--llui-chart-fill-dot)! forced-colors:data-[mark=area]:data-[series-cue=long-dash]:fill-(--llui-chart-fill-long-dash)! forced-colors:data-[mark=area]:data-[series-cue=dash-dot]:fill-(--llui-chart-fill-dash-dot)! forced-colors:data-[mark=area]:data-[series-cue=grid]:fill-(--llui-chart-fill-grid)! forced-colors:data-[mark=area]:data-[series-cue=cross-hatch]:fill-(--llui-chart-fill-cross-hatch)!',
)

/**
 * A vertex dot on a line or area series. Hidden until its row is active, which
 * is what makes the keyboard cursor visible without a permanent dot layer.
 *
 * A fill PATTERN (as `ChartMark` uses for bar/area) is illegible at marker
 * size, so the redundant forced-colors cue here instead varies radius, fill
 * vs hollow, and stroke dash — five genuinely distinct treatments per
 * `data-series-cue`, not five shades of the same filled disc. These replace
 * (not add to) the base `forced-colors:fill-[CanvasText]!`/`stroke-[Canvas]!`
 * pair, since `dot`/`dash-dot` deliberately swap which one is CanvasText.
 */
export const ChartDot = classPart(
  circle,
  'fill-(--mark-color) stroke-background stroke-2 opacity-0 transition-opacity data-active:opacity-100 motion-reduce:transition-none forced-colors:opacity-100! forced-colors:data-[series-cue=solid]:fill-[CanvasText]! forced-colors:data-[series-cue=solid]:stroke-[Canvas]! forced-colors:data-[series-cue=solid]:[r:4px] forced-colors:data-[series-cue=solid]:[stroke-dasharray:none] forced-colors:data-[series-cue=short-dash]:fill-[CanvasText]! forced-colors:data-[series-cue=short-dash]:stroke-[Canvas]! forced-colors:data-[series-cue=short-dash]:[r:5px] forced-colors:data-[series-cue=short-dash]:[stroke-dasharray:2_2] forced-colors:data-[series-cue=dot]:fill-[Canvas]! forced-colors:data-[series-cue=dot]:stroke-[CanvasText]! forced-colors:data-[series-cue=dot]:[r:5px] forced-colors:data-[series-cue=dot]:[stroke-dasharray:none] forced-colors:data-[series-cue=long-dash]:fill-[CanvasText]! forced-colors:data-[series-cue=long-dash]:stroke-[Canvas]! forced-colors:data-[series-cue=long-dash]:[r:6px] forced-colors:data-[series-cue=long-dash]:[stroke-width:3px] forced-colors:data-[series-cue=long-dash]:[stroke-dasharray:none] forced-colors:data-[series-cue=dash-dot]:fill-[Canvas]! forced-colors:data-[series-cue=dash-dot]:stroke-[CanvasText]! forced-colors:data-[series-cue=dash-dot]:[r:3px] forced-colors:data-[series-cue=dash-dot]:[stroke-width:1.5px] forced-colors:data-[series-cue=dash-dot]:[stroke-dasharray:1_1] forced-colors:data-[series-cue=grid]:fill-[Canvas]! forced-colors:data-[series-cue=grid]:stroke-[CanvasText]! forced-colors:data-[series-cue=grid]:[r:6px] forced-colors:data-[series-cue=grid]:[stroke-width:2.5px] forced-colors:data-[series-cue=grid]:[stroke-dasharray:none] forced-colors:data-[series-cue=cross-hatch]:fill-[CanvasText]! forced-colors:data-[series-cue=cross-hatch]:stroke-[Canvas]! forced-colors:data-[series-cue=cross-hatch]:[r:4.5px] forced-colors:data-[series-cue=cross-hatch]:[stroke-width:1px] forced-colors:data-[series-cue=cross-hatch]:[stroke-dasharray:1_1]',
)

/** The value gridlines. */
export const ChartGrid = classPart(
  path,
  'fill-none stroke-border/50 stroke-1 forced-colors:stroke-[GrayText]',
)

/** An axis label — category names and value ticks. */
export const ChartAxisLabel = classPart(
  svgText,
  'fill-muted-foreground text-[10px] data-active:fill-foreground data-active:font-medium forced-colors:fill-[CanvasText]',
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
  'ms-auto font-mono font-medium tabular-nums text-foreground',
)

// ── Legend (ported verbatim) ──────────────────────────────────────────────

export const ChartLegend = classPart(div, 'flex items-center justify-center gap-4 pt-3')

/** A `<button>`, not a div: `parts.legendItem(key)` spreads `type="button"` and
 *  `aria-pressed`, and isolating a series must be reachable from the keyboard.
 *  A dimmed series fades its SWATCH and strikes its label — the label is a live
 *  toggle's text and keeps full contrast (#268 audit: an item-wide
 *  `opacity-40` took it to 1.7:1). */
export const ChartLegendItem = classPart(
  button,
  'group/legend-item flex cursor-pointer items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 text-xs text-muted-foreground data-dimmed:line-through [&>svg]:h-3 [&>svg]:w-3',
)

/** `parts.legendSwatch(key)` spreads `data-series-cue`: without it the chip
 *  carries only `--mark-color`, which forced colors flattens to one uniform
 *  system colour across every legend entry (#264 review item 7). */
export const ChartLegendSwatch = classPart(
  span,
  'size-2 shrink-0 rounded-[2px] bg-(--mark-color) transition-opacity group-data-dimmed/legend-item:opacity-40 motion-reduce:transition-none forced-colors:[forced-color-adjust:none] forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:data-[series-cue=solid]:bg-[CanvasText] forced-colors:data-[series-cue=solid]:bg-none forced-colors:data-[series-cue=short-dash]:[background-image:var(--llui-chart-swatch-short-dash)] forced-colors:data-[series-cue=dot]:[background-image:var(--llui-chart-swatch-dot)] forced-colors:data-[series-cue=dot]:[background-size:4px_4px] forced-colors:data-[series-cue=long-dash]:[background-image:var(--llui-chart-swatch-long-dash)] forced-colors:data-[series-cue=dash-dot]:[background-image:var(--llui-chart-swatch-dash-dot)] forced-colors:data-[series-cue=grid]:[background-image:var(--llui-chart-swatch-grid)] forced-colors:data-[series-cue=cross-hatch]:[background-image:var(--llui-chart-swatch-cross-hatch)]',
)

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
