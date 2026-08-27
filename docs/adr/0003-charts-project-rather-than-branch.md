---
status: accepted
---

# Charts project rather than branch: one seam for cartesian and polar

A chart is two mappings. Data into normalized space — `u ∈ [0,1]` along the independent axis, `v ∈ [0,1]` for magnitude — which `packages/components/src/utils/scale.ts` owns and which involves no pixels. And normalized space onto the screen, which `packages/components/src/utils/projection.ts` owns and which is the ONLY place a cartesian chart and a polar one differ. `Projection` is an interface with `point` / `line` / `area` / `band` / `gridline` / `tick` / `valueTick` / `locate`; `cartesianProjection` and `polarProjection` implement it; nothing else in the package branches on the coordinate system.

That is what makes `coord: 'cartesian' | 'polar'` one field on the state. Switching it re-projects every mark, gridline, tick, hit test and tooltip anchor from the same series and the same data: a line becomes a radar outline, an area a filled radar polygon, a bar a wedge, a horizontal rule a ring. Grouped bars stay grouped as adjacent wedges, because the grouping is computed in `u` before the projection sees it. A consumer's view renders the derived geometry and never asks which projection produced it.

`@llui/components/chart` is a machine, not a class recipe. shadcn/ui's `chart.tsx` is a Recharts wrapper — a container injecting `--color-<key>` variables, plus tooltip and legend recipes — and Recharts is React-only. Of that, the theming bridge and the two surface recipes port and are in `registry/llui/ui/chart.ts`; the drawing, the hover and keyboard interaction, and the accessible fallback do not, and those are exactly what the package exists to stop every consumer re-implementing.

Nothing is drawn in the machine. It derives geometry as data — path strings, points, tick placements — memoized on state identity, and the view renders it with ordinary `elNS` SVG elements and keyed `each`. This is the shape `qr-code` already uses. It keeps a chart inside the reactive model instead of behind a `foreign()` seam owning its own DOM and its own state.

## Consequences

`width` / `height` are user units and go straight into the `viewBox`, so geometry is a pure function of state: no layout read, no `ResizeObserver`, and an SSR render matches the client. A consumer wanting true 1:1 pixels observes its own container and dispatches `setSize`. A `viewBox` that does not match the projection only leaves gutters — `frameOf` centres a polar frame on `min(width, height)` either way.

Polar declines `monotone` and `step` and draws `linear` instead. This is a correctness statement, not a gap: monotone cubic's defining guarantee is that it never overshoots between two samples, and it is defined on a function `y = f(x)` with increasing `x`. A closed angular loop has no such ordering, so honouring the request would draw values nobody measured. `Projection.curves` states the supported set, so the limit is introspectable rather than folklore.

No charting library, and no `d3-scale` / `d3-shape`. `@llui/components` has one runtime dependency (`@standard-schema/spec`, types only), and the subset a chart needs is two files of pure functions. The nice-number tick algorithm IS d3's, ported — it is published and well specified, and inventing a different one would make every axis here disagree with every chart anyone has seen.

Accessibility is a real `<table>`, not the WAI-ARIA graphics roles. The `<svg>` carries `role="img"` named through its own `<title>` and `<desc>`, and the visually-hidden table beside it carries the numbers. Support for `graphics-symbol` and friends is still thin enough that a chart relying on them announces a name and nothing else. `aria-activedescendant` is not valid on `role="img"`, so the keyboard cursor is announced through the tooltip's `role="status"` live region instead.

Only cartesian marks — line, area, bar — ship. They share one scale, axis, hit test and keyboard model. Pie and radial gauges reuse `polarProjection` but need their own domain and label rules, so they are a separate decision rather than a half-built one.

## Considered options

**A `foreign()` seam around an existing charting library** (Recharts is unavailable; ECharts, uPlot and Observable Plot are not). Fastest, and it costs everything the framework is for: hover state escapes the reducer, nothing is time-travelable or replayable, the DOM is opaque to the reconciler, and accessibility becomes whatever the library shipped.

**Ship the theming bridge and one chart type, leaving the engine open** — the narrow first pass the issue proposed. Rejected because a chart nobody can keyboard-navigate and no screen reader can read is the kind of thing that ships and never gets finished, and the bridge alone gives a consumer nothing to draw with.

**Branch on `coord` inside each mark.** The obvious shape, and the reason to write this down: it puts the same two-way decision in the line code, the area code, the bar code, the gridline code, the tick code and the hit test, where they drift independently. One interface with two implementations makes adding a coordinate system a new file rather than six edits.
