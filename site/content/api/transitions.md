---
title: '@llui/transitions'
description: 'Animation: transition(), presets, flip, spring, stagger'
---

# @llui/transitions

Animation helpers for [LLui](https://github.com/fponticelli/llui) structural primitives. Works with `show`, `branch`, and `each`.

```bash
pnpm add @llui/transitions
```

## Usage

Presets return a `TransitionOptions` bundle. Pass it **positionally** as the trailing `transition` argument to `show`/`branch`, or as the `transition:` option to `each` — never spread it. Element and structural helpers are module imports from `@llui/dom`; the view bag is `{ state, send }`.

```ts
import { show, div, text } from '@llui/dom'
import { fade, slide, mergeTransitions } from '@llui/transitions'

// Inside a component's view({ state, send }):
// Fade + slide on a show block (transition is the 4th positional arg)
show(
  state.at('visible'),
  () => div([text(state.map((s) => s.message))]),
  undefined, // no orElse arm
  mergeTransitions(fade(), slide({ direction: 'down' })),
)
```

## API

### Core

| Function                     | Description                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transition(spec)`           | Core primitive -- build a custom transition from a class/style spec (`enterFrom`, `enterTo`, `enterActive`, `leaveFrom`, `leaveTo`, `leaveActive`, plus `duration`, `appear`) |
| `mergeTransitions(...parts)` | Combine multiple transitions into one (chains their `enter`, `leave`, and `onTransition` handlers)                                                                            |

All presets and the core primitive return a `TransitionOptions` bundle — `{ enter?, leave?, onTransition? }` hooks that operate on raw DOM `Node`s.

### Presets

| Function             | Options                                                         | Description                                                                             |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `fade(options?)`     | `duration`, `easing`, `appear`                                  | Fade in/out                                                                             |
| `slide(options?)`    | `direction`, `distance`, `duration`, `easing`, `fade`, `appear` | Slide from direction (`up`, `down`, `left`, `right`)                                    |
| `scale(options?)`    | `from`, `duration`, `easing`, `fade`, `origin`, `appear`        | Scale transform in/out                                                                  |
| `collapse(options?)` | `axis`, `duration`, `easing`, `appear`                          | Collapse/expand along `y` (height) or `x` (width); measures the natural size at runtime |
| `flip(options?)`     | `duration`, `easing`                                            | FLIP reorder animation for `each()`                                                     |

### Spring Physics

| Function           | Options                                                               | Description                      |
| ------------------ | --------------------------------------------------------------------- | -------------------------------- |
| `spring(options?)` | `stiffness`, `damping`, `mass`, `precision`, `property`, `from`, `to` | Spring-physics animation via rAF |

Uses a damped spring simulation instead of CSS easing. The animation runs via `requestAnimationFrame` and settles naturally based on physics parameters.

```ts
import { show } from '@llui/dom'
import { spring } from '@llui/transitions'

// Default: opacity 0 → 1 with react-spring-like defaults
show(state.at('open'), () => content(), undefined, spring())

// Custom spring feel
show(
  state.at('open'),
  () => content(),
  undefined,
  spring({ stiffness: 300, damping: 15, property: 'opacity' }),
)
```

### Route Transitions

| Function                    | Options                                        | Description                                  |
| --------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `routeTransition(options?)` | `duration`, `easing`, `slide`, `slideDistance` | Fade + slide for `branch()` page transitions |

Convenience wrapper for animating page transitions in a `branch()`:

```ts
// @doc-skip — uses `[...]` render-result placeholders
import { branch } from '@llui/dom'
import { routeTransition, fade } from '@llui/transitions'

// Default: fade + slight upward slide (250ms)
branch(
  state.map((s) => s.route.page),
  { home: () => [...], about: () => [...] },
  routeTransition(),
)

// Custom duration
branch(state.map((s) => s.route.page), arms, routeTransition({ duration: 200 }))

// Fade only (no slide)
branch(state.map((s) => s.route.page), arms, routeTransition({ duration: 200, slide: false }))

// Pass any preset directly
branch(state.map((s) => s.route.page), arms, routeTransition(fade({ duration: 200 })))
```

### Stagger

| Function                        | Options                      | Description                                       |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| `stagger(transition, options?)` | `delayPerItem`, `leaveOrder` | Stagger enter/leave animations for `each()` items |

Wraps any transition preset so batch-entered items animate with incremental delays. Pass the result as `each`'s `transition:` option:

```ts
// @doc-skip — uses `[...]` render-result placeholder
import { each } from '@llui/dom'
import { stagger, fade, slide } from '@llui/transitions'

each(state.at('items'), {
  key: (i) => i.id,
  render: (item) => [...],
  transition: stagger(fade({ duration: 150 }), { delayPerItem: 30 }),
})

// Works with any preset
each(state.at('items'), {
  key: (i) => i.id,
  render: (item) => [...],
  transition: stagger(slide({ direction: 'up' }), { delayPerItem: 50 }),
})

// Stagger leave animations too (default is simultaneous)
each(state.at('items'), {
  key: (i) => i.id,
  render: (item) => [...],
  transition: stagger(fade(), { delayPerItem: 30, leaveOrder: 'sequential' }),
})
```

Items entering within the same microtask are considered a "batch" and get sequential delays. The counter resets after the microtask boundary, so the next batch starts from index 0.

### Integration

Presets return a `TransitionOptions` object (`{ enter?, leave?, onTransition? }`). Pass it **positionally** to `show`/`branch` (the trailing `transition` argument) or as the `transition:` option to `each` — do not spread it. Row `render` callbacks receive a `Signal` handle (e.g. `item` is `Signal<T>`).

```ts
import { show, each, li, text } from '@llui/dom'
import { fade, flip } from '@llui/transitions'

// show with fade — transition is the 4th positional arg
show(state.at('open'), () => content(), undefined, fade())

// each with FLIP reorder — transition is an option in the second arg
each(state.at('list'), {
  key: (item) => item.id,
  render: (item) => li([text(item.map((i) => i.name))]),
  transition: flip({ duration: 200 }),
})
```

<!-- auto-api:start -->

## Functions

### `collapse()`

Animate an element open/closed along the y-axis (height) or x-axis (width).

Unlike CSS-only presets, `collapse()` measures the element's natural size
at runtime — the animation works regardless of content size. Only the
first element in each `nodes` group is animated.

Because it mutates `overflow` / `height` / `transition` inline, collapse
registers a per-element restore that runs the moment a later phase supersedes
it — so an interrupted open/close never leaves stale inline styles behind.

Like the other presets, this bundle is passed as the trailing transition
argument to the signal `show`/`branch`/`each` primitives (e.g.
`show(state.at('open'), () => [panel()], undefined, collapse())`) and is also
consumed at the route/container seam via `fromTransition`.

```typescript
function collapse(opts: CollapseOptions = {}): TransitionOptions
```

### `fade()`

```typescript
function fade(opts: FadeOptions = {}): TransitionOptions
```

### `flip()`

FLIP (First-Last-Invert-Play) reorder animation for keyed lists.

`onTransition` runs after a reconcile with `{ entering, leaving, parent }`.
It compares each surviving child's last-known LAYOUT position (kept in a
`WeakMap<Element, Point>`) against its new one and, for any that moved,
plays an inverse-then-identity transform so the row appears to glide.

A pass is split into a read phase and a write phase: every measurement
(`getBoundingClientRect`, the computed transform) happens before the first
`cancel()`/`animate()`, so a K-row reorder forces layout ONCE rather than
once per row. Do not reintroduce a write between the reads.

Interruption: the live `Animation` is retained per element and cancelled
before the next one starts, and the new delta is measured from where the row
VISUALLY is — its previous layout box plus whatever translation the running
glide had already applied — so an interrupted reorder continues rather than
jumping. `getBoundingClientRect` reports the transformed box, so the stored
position is the rect with that translation subtracted back out. The run ENDS
when the glide completes (or is cancelled by anyone, including someone other
than us): only while one is live is the computed transform ours to read, and
a run left registered makes every later pass measure a row's own author
transform as if it were a glide.

Known defect (#144): the keyframes below set `transform` to a translation
alone, so they REPLACE the row's own `transform` rather than composing with
it, and a running WAAPI animation wins the cascade. A row carrying a non-zero
CONSTANT author transform (a hover lift, a drag offset) therefore jumps by
that amount when a glide starts and jumps back when it ends. The DELTA is
unaffected — the author transform is folded into both the stored position and
the new rect and cancels out — so this is bounded, cosmetic and
self-correcting. The fix is to compose the author transform into both
keyframes; see the issue for why that trades against the single-read rule
above.

Element retention is deliberately weak: the tracked positions live in a
`WeakMap` and the working set is derived from `parent`'s live children
(minus `leaving`) on each pass, so bulk-removed rows are never held and are
free to be garbage-collected. There is no independent strong Set.

Combine with an item-level appear/disappear preset via `mergeTransitions`:

```ts
mergeTransitions(fade(), flip())
```

The signal `each()` primitive invokes `onTransition` (with the entering /
leaving / parent for the reconcile), so passing `flip()` as `each`'s trailing
transition argument animates surviving rows to their new positions:

```ts
each(state.at('rows'), (r) => r.id, row, undefined, flip({ duration: 300 }))
// or combined with an appear/disappear preset:
each(state.at('rows'), (r) => r.id, row, undefined, mergeTransitions(fade(), flip()))
```

Requires WAAPI (`element.animate()`). In environments without it (old
browsers, minimal jsdom) positions are still tracked but no animation runs.

```typescript
function flip(opts: FlipOptions = {}): TransitionOptions
```

### `mergeTransitions()`

Merge multiple TransitionOptions into one, chaining their `enter`,
`leave`, and `onTransition` handlers in order. `leave` waits for every
part's returned Promise before resolving.

Useful for combining an item-level animation (fade/slide/...) with flip():

```ts
mergeTransitions(fade(), flip())
```

The merged bundle is passed as the trailing transition argument to
`show`/`branch`/`each` (or adapted onto a route via `fromTransition`); `each`
drives the `onTransition` half of a `flip()` part. See `flip()`.

```typescript
function mergeTransitions(...parts: TransitionOptions[]): TransitionOptions
```

### `routeTransition()`

Convenience wrapper that returns `{ enter, leave }` hooks suitable for
animating page-to-page transitions.

**Vike filesystem routing (`@llui/vike`):** this is the wired consumer.
Vike's `onRenderClient` doesn't take `{ enter, leave }` directly — each page
is its own component and the swap goes through dispose + clear + mount — so
`fromTransition` from `@llui/vike/client` adapts the bundle to the
`onLeave` / `onEnter` hook shape:

```ts
// pages/+onRenderClient.ts
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'

export const onRenderClient = createOnRenderClient({
  ...fromTransition(routeTransition({ duration: 200 })),
})
```

The vike variant operates on the container / page-slot element itself — its
opacity / transform fades out the whole page, then the new page fades in when
it mounts.

> Note: this preset targets the WHOLE page slot. For animating individual
> arms/rows, pass a preset bundle (`fade`/`slide`/`flip`/…) as the trailing
> transition argument to `show`/`branch`/`each` directly; `routeTransition`
> via `fromTransition` is for the page-to-page/container swap.

The call form also accepts a pre-built `TransitionOptions` from any preset or
composition (`fade`, `slide`, `scale`, `flip`, `mergeTransitions`, …) —
detected by the presence of an `enter`, `leave`, or `onTransition` hook — and
passes it through unchanged.

```typescript
function routeTransition(opts?: RouteTransitionOptions | TransitionOptions): TransitionOptions
```

### `scale()`

Scale an element in/out from `from` to 1, optionally fading with it.

> **Known defect (#142).** Carries the same malformed `transition` shorthand
> as {@link slide}: `transform, opacity 200ms ease-out` gives `transform` a 0s
> duration, so it snaps rather than scaling and never reports a
> `transitionend` — the phase resolves on the fallback timer instead.

```typescript
function scale(opts: ScaleOptions = {}): TransitionOptions
```

### `slide()`

Slide an element in/out along one axis, optionally fading with it.

> **Known defect (#142).** The active value is built as
> `transition: transform, opacity 250ms ease-out`, which the CSS shorthand
> grammar reads as TWO single-transitions — the first, `transform`, taking the
> initial `transition-duration` of **0s**. In a real browser the transform
> therefore SNAPS and only the opacity animates. A 0s transition also fires no
> `transitionend`, so `transform` never leaves the set of properties the phase
> waits on (see {@link waitForEnd}) and the phase always resolves on the
> fallback timer rather than on a real end — 16ms late, never a hang. Do not
> read the property filter as "every shipped preset lines up with it": `fade()`
> does, `slide()` and `scale()` do not until #142 lands.

```typescript
function slide(opts: SlideOptions = {}): TransitionOptions
```

### `spring()`

Spring-physics transition. Returns `{ enter, leave }` that animate a CSS
property using a damped spring simulation driven by `requestAnimationFrame`.

When `requestAnimationFrame` can't drive the loop — server render, or a
hidden/background tab where rAF is paused — the animation settles instantly
to its target and the returned Promise still resolves. This matters for the
`leave` Promise: it gates DOM removal, so a spring leave in a hidden tab must
not hang (e.g. `fromTransition(spring())` route navigation). Honoring
`prefers-reduced-motion` takes the same instant-settle path.

Interruption: enter and leave on the SAME element supersede each other. A new
phase cancels the previous element's loop WITHOUT letting it snap to its own
(now-stale) target, so an enter interrupted by a leave rests at the leave
target rather than being clobbered back to the enter target by the dying loop.
Either direction resumes from the element's CURRENT value — the endpoints
`from`/`to` are resting starts, used only when nothing is in flight.

Passed as the trailing transition argument to the signal `show`/`branch`/`each`
primitives to spring an arm/row in and defer its leave, e.g.
`show(state.at('open'), () => [panel()], undefined, spring())`; also consumed
at the route/container seam via `fromTransition` in `@llui/vike/client`.

```typescript
function spring(opts: SpringOptions = {}): TransitionOptions
```

### `stagger()`

```typescript
function stagger(spec: TransitionOptions, opts?: StaggerOptions): TransitionOptions
```

### `transition()`

Build a `TransitionOptions` bundle (`{ enter, leave }`) from a class/style spec.

The returned hooks operate on raw DOM `Node`s and are invoked by two seams:

- **Element-level structural transitions** — the signal `show`/`branch`/`each`
  primitives accept this `TransitionOptions` bundle directly and drive it:
  `enter` animates a freshly-mounted arm/row in, and `leave` DEFERS the
  swapped-out arm/row's unmount until its promise resolves. Pass a bundle as
  the trailing argument:

  ```ts
  show(state.at('open'), () => [panel()], undefined, fade({ duration: 150 }))
  branch(state, (s) => s.tab, { a: () => [tabA()], b: () => [tabB()] }, slide())
  each(state.at('items'), (i) => i.id, row, undefined, fade({ duration: 120 }))
  ```

- **Route/container** seam — `fromTransition(...)` in `@llui/vike/client`
  adapts the same bundle onto the page slot element (see `routeTransition`)
  for whole-view/route navigations rather than individual arms.

Lifecycle:

- **enter**: apply `enterFrom` + `enterActive` → reflow → swap `enterFrom` → `enterTo`
  → wait for `transitionend` (timer fallback) → remove all transient values.
- **leave**: apply `leaveFrom` + `leaveActive` → reflow → swap `leaveFrom` → `leaveTo`
  → resolve on `transitionend` (timer fallback) so DOM removal is deferred.

Interruption: enter/leave on a reused element are guarded by a per-element run
token — a new phase first rolls back the previous phase's transient values,
and a superseded phase's delayed cleanup is skipped. This holds for a leave
that already COMPLETED too: it keeps its resting values (the arm is about to
be detached) but stays registered, so if the element is instead reused — the
route seam calls `enter` on the very element it just left — the enter clears
that residue before snapshotting its own baseline.

Interrupting a phase mid-flight resumes from the element's CURRENT rendered
values in BOTH directions, by the same mechanism: the animated properties are
frozen at what the element is showing and applied in place of the phase's
`from` value, so neither direction re-animates from the far end. Freezing is
what makes it work — merely SKIPPING the `from` value is not enough, because
superseding the interrupted phase fires its rollback, which restores the
pre-phase inline value (for a fade, `''` — fully visible). A phase that has
already settled counts as resting, not as an interrupt.

Completion: a phase resolves only once EVERY property it animates (the style
keys of its `from`/`to` values) has reported a `transitionend` on the element
itself — an unrelated `transitionend` (a hover `background-color`, or the fast
half of `transition: opacity 100ms, transform 500ms`) does not end the phase,
because the runtime detaches a leaving node on exactly that promise. A
class-only spec names no properties, so any end on the target resolves it.

Duration (used only for the fallback timer / when no CSS transition fires):

- If `duration` is given, it is used verbatim.
- Otherwise, computed `transition-duration + transition-delay` is read after
  the active/from values are applied, taking the max across properties.

```typescript
function transition(spec: TransitionSpec): TransitionOptions
```

## Types

### `SlideDirection`

```typescript
export type SlideDirection = 'up' | 'down' | 'left' | 'right'
```

### `Styles`

CSS style properties as a plain object. Numeric values are automatically
suffixed with `px` for known dimensional properties.

Example: `{ opacity: 0, transform: 'scale(0.95)', width: 200 }`

```typescript
export type Styles = Record<string, string | number>
```

### `TransitionValue`

One "state" in a transition.

- `string` — space-separated class names (applied via classList)
- `Styles` — inline style object (applied via element.style)
- `Array<string | Styles>` — mix both (useful for utility classes + dynamic styles)

```typescript
export type TransitionValue = string | Styles | Array<string | Styles>
```

## Interfaces

### `CollapseOptions`

```typescript
export interface CollapseOptions {
  /** Axis to collapse: 'y' = height, 'x' = width (default: 'y'). */
  axis?: 'x' | 'y'
  duration?: number
  easing?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `FadeOptions`

```typescript
export interface FadeOptions {
  duration?: number
  easing?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `FlipOptions`

```typescript
export interface FlipOptions {
  duration?: number
  easing?: string
  /** Honor `prefers-reduced-motion` (default: true) — skip the reorder animation (rows jump) when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `RouteTransitionOptions`

```typescript
export interface RouteTransitionOptions {
  /** Duration in milliseconds (default: 250). */
  duration?: number
  /** Easing function (default: 'ease-out'). */
  easing?: string
  /** Enable a slight vertical slide alongside the fade (default: true). */
  slide?: boolean
  /** Slide distance in pixels (default: 12). */
  slideDistance?: number
}
```

### `ScaleOptions`

```typescript
export interface ScaleOptions {
  /** Starting scale factor (default: 0.95). */
  from?: number
  duration?: number
  easing?: string
  /** Also animate opacity (default: true). */
  fade?: boolean
  /** Transform origin (default: 'center'). */
  origin?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `SlideOptions`

```typescript
export interface SlideOptions {
  /** The direction the element slides IN from (default: 'down' — enters from below). */
  direction?: SlideDirection
  /** Pixel distance to slide (default: 20). */
  distance?: number
  duration?: number
  easing?: string
  /** Also animate opacity (default: true). */
  fade?: boolean
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `SpringOptions`

```typescript
export interface SpringOptions {
  /** Spring stiffness (default: 170). */
  stiffness?: number
  /** Damping coefficient (default: 26). */
  damping?: number
  /** Mass (default: 1). */
  mass?: number
  /** Stop threshold for velocity and position (default: 0.01). */
  precision?: number
  /** CSS property to animate (default: 'opacity'). */
  property?: string
  /** Start value (default: 0). */
  from?: number
  /** End value (default: 1). */
  to?: number
  /** Honor `prefers-reduced-motion` (default: true) — jump to the target instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `StaggerOptions`

```typescript
export interface StaggerOptions {
  /** Delay between each item in milliseconds (default: 30). */
  delayPerItem?: number
  /** How to stagger leave animations: 'sequential' (same order as enter),
   *  'reverse', or 'simultaneous' (no stagger). Default: 'simultaneous'. */
  leaveOrder?: 'sequential' | 'reverse' | 'simultaneous'
  /** Honor `prefers-reduced-motion` (default: true) — drop the per-item stagger delays when reduced motion is requested. */
  respectReducedMotion?: boolean
}
```

### `TransitionSpec`

```typescript
export interface TransitionSpec {
  /** Initial state before enter animation (removed once enter completes). */
  enterFrom?: TransitionValue
  /** Final state during enter animation (removed once enter completes). */
  enterTo?: TransitionValue
  /** Applied throughout enter (typically the `transition-*` / `animation` properties). */
  enterActive?: TransitionValue
  /** Initial state before leave animation. */
  leaveFrom?: TransitionValue
  /** Final state during leave animation. */
  leaveTo?: TransitionValue
  /** Applied throughout leave. */
  leaveActive?: TransitionValue
  /**
   * Explicit duration in milliseconds. When omitted, the duration is read from
   * the element's computed `transition-duration` / `transition-delay` after the
   * active classes are applied.
   */
  duration?: number
  /** If true, run the enter transition on initial mount (default: true). */
  appear?: boolean
  /**
   * Honor the user's `prefers-reduced-motion: reduce` setting (default: true).
   * When reduced motion is requested, enter/leave resolve instantly to the final
   * state instead of animating. Set `false` to always animate.
   */
  respectReducedMotion?: boolean
}
```

<!-- auto-api:end -->
