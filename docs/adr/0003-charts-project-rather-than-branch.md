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

Pie, donut, the 100%-share bar and radial bars all ship, and none of them is a mark type. There are still exactly three marks — line, area, bar — sharing one scale, axis, hit test and keyboard model.

The deferred question was where a pie's own domain rule belongs, and the answer turned out to be the same seam: a pie is a bar whose MAGNITUDE has moved from `v` to `u`. `ChartState.domain` selects it — `value` gives every category an equal slot (`bandExtent`) and reads magnitude off `v`; `share` allocates each category a slot in proportion to its value (`shareExtents`) and lets `v` span the whole depth. Under `coord: 'polar'` that is a pie or donut; under `coord: 'cartesian'` the same state is a single full-width 100%-share bar. `coord` still re-projects one dataset rather than swapping charts, which a `'pie'` mark type could not have preserved: a `mark: 'pie'` under a cartesian projection means nothing, so it would have had to force polar or draw nothing, and either answer breaks the property this document exists to protect.

Radial bars needed no new field at all. `horizontal` already means "the independent axis moves off its default screen axis", and `polarProjection` simply had not honoured it; reading it there as "off the angle, onto the radius" gives concentric rings whose arc length is the magnitude. One flag, the same meaning in both coordinate systems, so flipping `coord` preserves the orientation a consumer asked for.

Three consequences worth stating, all of them the same kind of call as polar declining `monotone`. A share axis carries no padding — the slot IS the datum, so a gap would make every slice misstate its share. A negative value takes no arc, because a share of a negative is undefined and both silent readings (magnitude, or subtraction) either invent data or push the total past 1. And `line`/`area` series are declined under a share domain rather than approximated, since an axis whose spacing already encodes the magnitude would place every point at a position meaning something else.

## Considered options

**A `foreign()` seam around an existing charting library** (Recharts is unavailable; ECharts, uPlot and Observable Plot are not). Fastest, and it costs everything the framework is for: hover state escapes the reducer, nothing is time-travelable or replayable, the DOM is opaque to the reconciler, and accessibility becomes whatever the library shipped.

**Ship the theming bridge and one chart type, leaving the engine open** — the narrow first pass the issue proposed. Rejected because a chart nobody can keyboard-navigate and no screen reader can read is the kind of thing that ships and never gets finished, and the bridge alone gives a consumer nothing to draw with.

**A `'pie'` mark type, with its own domain and label rules inside the geometry pass.** The obvious shape, and the one Recharts' vocabulary suggests, so a reader porting a shadcn chart looks for the word. Rejected because it puts the coordinate system back inside the mark by the back door: `mark: 'pie'` is meaningless under a cartesian projection, so it must either silently force polar — making `coord` no longer the one field that decides — or draw nothing. It also duplicates the band and stacking logic a bar already has, to express what is really one substitution in how `u` is allocated.

**Branch on `coord` inside each mark.** The obvious shape, and the reason to write this down: it puts the same two-way decision in the line code, the area code, the bar code, the gridline code, the tick code and the hit test, where they drift independently. One interface with two implementations makes adding a coordinate system a new file rather than six edits.
