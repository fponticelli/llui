# @llui/transitions

Animation helpers for [LLui](https://github.com/fponticelli/llui) structural primitives. Works with `show`, `branch`, and `each`.

```bash
pnpm add @llui/transitions
```

## Usage

```ts
// @doc-skip — illustrative; uses bare `view({...})` shorthand and `text((s) => …)` placeholder values
import { fade, slide, mergeTransitions } from '@llui/transitions'
import { div } from '@llui/dom'

// Fade + slide on a show block
view({ show, text }) {
  show({
    when: (s) => s.visible,
    render: () => div({}, text((s) => s.message)),
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

// Default: opacity 0 → 1 with react-spring-like defaults
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
// @doc-skip — uses `[...]` render-result placeholders
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
// @doc-skip — uses `[...]` render-result placeholder
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
