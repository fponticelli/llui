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
  () => div({}, text(state.map((s) => s.message))),
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
  render: (item) => li({}, text(item.map((i) => i.name))),
  transition: flip({ duration: 200 }),
})
```
