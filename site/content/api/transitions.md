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

### `transition()`

Build a `TransitionOptions` bundle ({ enter, leave }) from a spec.
Pass the result into `branch`, `show`, or `each` to animate the enter/leave
of that structural block.
Lifecycle:
 - **enter**: apply `enterFrom` + `enterActive` → reflow → swap `enterFrom` → `enterTo`
   → wait for duration → remove all transient values (element rests on its base styles).
 - **leave**: apply `leaveFrom` + `leaveActive` → reflow → swap `leaveFrom` → `leaveTo`
   → wait for duration (Promise-resolved so DOM removal is deferred).
Duration:
 - If `duration` is given, it is used verbatim.
 - Otherwise, computed `transition-duration + transition-delay` is read after
   the active/from classes are applied, taking the max across properties.

```typescript
function transition(spec: TransitionSpec): TransitionOptions
```

### `fade()`

```typescript
function fade(opts: FadeOptions = {}): TransitionOptions
```

### `slide()`

```typescript
function slide(opts: SlideOptions = {}): TransitionOptions
```

### `scale()`

```typescript
function scale(opts: ScaleOptions = {}): TransitionOptions
```

### `collapse()`

Animate an element open/closed along the y-axis (height) or x-axis (width).
Unlike CSS-only presets, `collapse()` measures the element's natural size
at runtime — the animation works regardless of content size. Only the
first element in each `nodes` group is animated.

```typescript
function collapse(opts: CollapseOptions = {}): TransitionOptions
```

### `spring()`

Spring-physics transition. Returns `{ enter, leave }` that animate a CSS
property using a damped spring simulation driven by `requestAnimationFrame`.
```ts
show({ when: (s) => s.open, render: () => content(), ...spring() })
show({ ...spring({ property: 'transform', from: 0, to: 1 }) })
```

```typescript
function spring(opts: SpringOptions = {}): TransitionOptions
```

### `flip()`

FLIP (First-Last-Invert-Play) reorder animation for `each()` lists.
Attach to an `each()` alongside item enter/leave transitions. After each
reconcile, items whose positions changed animate smoothly from their
previous position to the new one.
```ts
each({
  items: s => s.items,
  key: i => i.id,
  render,
  ...fade(),         // animates appear/disappear
  ...flip(),         // animates reorders
})
```
Spreading two transition helpers merges their hooks: `fade()` provides
`enter`/`leave`, `flip()` provides `enter` (position capture) and
`onTransition` (apply inverse + play). The `enter` from `flip()` overrides
`fade()`'s only if spread after — put `flip()` last.
Actually, to combine both, use `mergeTransitions(fade(), flip())` which
chains `enter` handlers.
Requires WAAPI (`element.animate()`). In environments without it (old
browsers, minimal jsdom) the transforms are applied without animation.

```typescript
function flip(opts: FlipOptions = {}): TransitionOptions
```

### `mergeTransitions()`

Merge multiple TransitionOptions into one, chaining their `enter`,
`leave`, and `onTransition` handlers in order.
Useful for combining an item-level animation (fade/slide/...) with flip():
```ts
each({ items, key, render, ...mergeTransitions(fade(), flip()) })
```

```typescript
function mergeTransitions(...parts: TransitionOptions[]): TransitionOptions
```

### `routeTransition()`

Convenience wrapper that returns `{ enter, leave }` hooks suitable for
spreading into a `branch()` call to animate page transitions.
Can be called two ways:
1. With route-specific options (produces a fade + optional slide):
   ```ts
   branch({ on, cases, ...routeTransition({ duration: 200 }) })
   ```
2. With a pre-built `TransitionOptions` (e.g. from any preset):
   ```ts
   branch({ on, cases, ...routeTransition(fade({ duration: 200 })) })
   ```

```typescript
function routeTransition(opts?: RouteTransitionOptions | TransitionOptions): TransitionOptions
```

### `stagger()`

Wrap any transition preset so that batch-entered items get staggered delays.
Items entering within the same microtask are considered a "batch" and get
sequential delays (`index * delayPerItem`). The counter resets after the
microtask, so the next batch starts from 0.
```ts
each({
  items: s => s.items,
  key: i => i.id,
  render: ({ item }) => [...],
  ...stagger(fade({ duration: 150 }), { delayPerItem: 30 }),
})
```

```typescript
function stagger(spec: TransitionOptions, opts?: StaggerOptions): TransitionOptions
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

### `FadeOptions`

```typescript
export interface FadeOptions {
  duration?: number
  easing?: string
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
