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

```ts
import { fade, slide, mergeTransitions } from '@llui/transitions'
import { div } from '@llui/dom'

// Fade + slide on a show block
view({ show, text }) {
  show({
    when: (s) => s.visible,
    render: () => div([text((s) => s.message)]),
    ...mergeTransitions(fade(), slide({ direction: 'down' })),
  })
}
```

## API

### Core

| Function                       | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `transition({ enter, leave })` | Core transition -- define custom enter/leave animations |
| `mergeTransitions(a, b)`       | Combine two transitions into one                        |

### Presets

| Function             | Options                           | Description                                          |
| -------------------- | --------------------------------- | ---------------------------------------------------- |
| `fade(options?)`     | `duration`, `easing`              | Fade in/out                                          |
| `slide(options?)`    | `direction`, `duration`, `easing` | Slide from direction (`up`, `down`, `left`, `right`) |
| `scale(options?)`    | `from`, `duration`, `easing`      | Scale transform in/out                               |
| `collapse(options?)` | `duration`, `easing`              | Height collapse/expand                               |
| `flip(options?)`     | `duration`, `easing`              | FLIP reorder animation for `each()`                  |

### Spring Physics

| Function           | Options                                                               | Description                      |
| ------------------ | --------------------------------------------------------------------- | -------------------------------- |
| `spring(options?)` | `stiffness`, `damping`, `mass`, `precision`, `property`, `from`, `to` | Spring-physics animation via rAF |

Uses a damped spring simulation instead of CSS easing. The animation runs via `requestAnimationFrame` and settles naturally based on physics parameters.

```ts
import { spring } from '@llui/transitions'

// Default: opacity 0 -> 1 with react-spring-like defaults
show({ when: (s) => s.open, render: () => content(), ...spring() })

// Custom spring feel
show({
  when: (s) => s.open,
  render: () => content(),
  ...spring({ stiffness: 300, damping: 15, property: 'opacity' }),
})
```

### Route Transitions

| Function                    | Options                                        | Description                                  |
| --------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `routeTransition(options?)` | `duration`, `easing`, `slide`, `slideDistance` | Fade + slide for `branch()` page transitions |

Convenience wrapper for animating page transitions in a `branch()`:

```ts
import { routeTransition, fade } from '@llui/transitions'

// Default: fade + slight upward slide (250ms)
branch({
  on: (s) => s.route.page,
  cases: { home: () => [...], about: () => [...] },
  ...routeTransition(),
})

// Custom duration
branch({ on, cases, ...routeTransition({ duration: 200 }) })

// Fade only (no slide)
branch({ on, cases, ...routeTransition({ duration: 200, slide: false }) })

// Pass any preset directly
branch({ on, cases, ...routeTransition(fade({ duration: 200 })) })
```

### Stagger

| Function                        | Options                      | Description                                       |
| ------------------------------- | ---------------------------- | ------------------------------------------------- |
| `stagger(transition, options?)` | `delayPerItem`, `leaveOrder` | Stagger enter/leave animations for `each()` items |

Wraps any transition preset so batch-entered items animate with incremental delays:

```ts
import { stagger, fade, slide } from '@llui/transitions'

each({
  items: (s) => s.items,
  key: (i) => i.id,
  render: ({ item }) => [...],
  ...stagger(fade({ duration: 150 }), { delayPerItem: 30 }),
})

// Works with any preset
each({
  items: (s) => s.items,
  key: (i) => i.id,
  render: ({ item }) => [...],
  ...stagger(slide({ direction: 'up' }), { delayPerItem: 50 }),
})

// Stagger leave animations too (default is simultaneous)
each({
  ...stagger(fade(), { delayPerItem: 30, leaveOrder: 'sequential' }),
})
```

Items entering within the same microtask are considered a "batch" and get sequential delays. The counter resets after the microtask boundary, so the next batch starts from index 0.

### Integration

Presets return `{ enter, leave }` objects that spread directly into `show`, `branch`, or `each`:

```ts
// show with fade
show({ when: (s) => s.open, render: () => content(), ...fade() })

// each with FLIP reorder
each({
  items: (s) => s.list,
  key: (item) => item.id,
  render: (item) =>
    li(
      {},
      text(() => item.name),
    ),
  ...flip({ duration: 200 }),
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
Like the other presets, these hooks are consumed at the route/container seam
(`fromTransition`), not by the not-yet-wired structural primitives.

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
It compares each surviving child's last-known position (kept in a
`WeakMap<Element, DOMRect>`) against its new one and, for any that moved,
plays an inverse-then-identity transform so the row appears to glide.
Element retention is deliberately weak: the tracked positions live in a
`WeakMap` and the working set is derived from `parent`'s live children
(minus `leaving`) on each pass, so bulk-removed rows are never held and are
free to be garbage-collected. There is no independent strong Set.
Combine with an item-level appear/disappear preset via `mergeTransitions`:

```ts
mergeTransitions(fade(), flip())
```

**Not yet wired:** the signal `each()` primitive does not currently invoke
`onTransition`, so spreading `flip()` onto an `each({...})` has no effect.
Wiring the structural reconcilers to call these hooks is a deferred
cross-package change; `flip()` and `mergeTransitions()` are the building
blocks that seam will consume.
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

(As with `flip()`, the `onTransition` half is only meaningful once the
structural reconcilers invoke it — not yet wired. See `flip()`.)

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

> Note: spreading the result directly into a `branch()`/`show()` call does
> **not** animate anything today — the signal structural primitives don't yet
> accept transition hooks. Route-level animation goes through
> `fromTransition`, not the structural primitives.
> The call form also accepts a pre-built `TransitionOptions` from any preset or
> composition (`fade`, `slide`, `scale`, `flip`, `mergeTransitions`, …) —
> detected by the presence of an `enter`, `leave`, or `onTransition` hook — and
> passes it through unchanged.

```typescript
function routeTransition(opts?: RouteTransitionOptions | TransitionOptions): TransitionOptions
```

### `scale()`

```typescript
function scale(opts: ScaleOptions = {}): TransitionOptions
```

### `slide()`

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
not hang (e.g. `fromTransition(spring())` route navigation).
Consumed at the route/container seam via `fromTransition` in
`@llui/vike/client`. The signal `show`/`each`/`branch` primitives do **not**
currently accept transition hooks, so `show({ ...spring() })` is not yet
wired — that structural seam is a deferred cross-package change.

```typescript
function spring(opts: SpringOptions = {}): TransitionOptions
```

### `stagger()`

Wrap any transition preset so that batch-entered items get staggered delays.
Items entering within the same microtask are considered a "batch" and get
sequential delays (`index * delayPerItem`). The counter resets after the
microtask, so the next batch starts from 0.

```ts
stagger(fade({ duration: 150 }), { delayPerItem: 30 })
```

**Not yet wired for lists:** staggering only produces visible per-item delays
once the structural `each()` primitive invokes the `enter`/`leave` hooks per
row, which it does not do today. Until that runtime seam lands, `stagger`
wraps a bundle but there is no `each()` call site feeding it batched rows.

```typescript
function stagger(spec: TransitionOptions, opts?: StaggerOptions): TransitionOptions
```

### `transition()`

Build a `TransitionOptions` bundle (`{ enter, leave }`) from a class/style spec.
The returned hooks operate on raw DOM `Node`s. Today the only place the
runtime actually invokes them is the **route/container** seam:
`fromTransition(...)` in `@llui/vike/client` adapts the bundle onto the page
slot element (see `routeTransition`). Element-level structural transitions —
animating individual `show`/`branch`/`each` arms — are **not yet wired**: the
signal `show`/`each`/`branch` primitives do not currently accept transition
hooks, so `show({ ...fade() })` / `each({ ...fade() })` do nothing. That
runtime seam is a deferred cross-package change; until it lands, drive these
bundles through the route-level adapter, not the structural primitives.
Lifecycle:

- **enter**: apply `enterFrom` + `enterActive` → reflow → swap `enterFrom` → `enterTo`
  → wait for `transitionend` (timer fallback) → remove all transient values.
- **leave**: apply `leaveFrom` + `leaveActive` → reflow → swap `leaveFrom` → `leaveTo`
  → resolve on `transitionend` (timer fallback) so DOM removal is deferred.
  Interruption: enter/leave on a reused element are guarded by a per-element run
  token — a new phase first rolls back the previous phase's transient values,
  and a superseded phase's delayed cleanup is skipped.
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
}
```

### `FadeOptions`

```typescript
export interface FadeOptions {
  duration?: number
  easing?: string
  appear?: boolean
}
```

### `FlipOptions`

```typescript
export interface FlipOptions {
  duration?: number
  easing?: string
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
}
```

<!-- auto-api:end -->
