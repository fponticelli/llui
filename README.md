# LLui

A compile-time-optimized web framework built on [The Elm Architecture](https://guide.elm-lang.org/architecture/), designed for LLM-first authoring.

```typescript
import { component, div, button, text } from '@llui/core'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc': return [{ ...state, count: state.count + 1 }, []]
      case 'dec': return [{ ...state, count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: (_state, send) => div({ class: 'counter' }, [
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text(s => String(s.count)),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ]),
})
```

## Why

- **No virtual DOM.** `view()` runs once at mount. Reactive bindings update the DOM surgically via bitmask-gated dirty checking — the cost of an update scales with what changed, not the tree size.
- **Effects as data.** `update()` is pure. Side effects are plain objects returned alongside state, dispatched by the runtime. Testable with `assert.deepEqual`.
- **Compile-time optimization.** The Vite plugin extracts state access paths from accessor functions, assigns bitmask bits, and synthesizes `__dirty()` per component. No runtime dependency tracking overhead.
- **LLM-friendly.** One canonical pattern per concept. Discriminated unions for messages and effects. TypeScript exhaustiveness checking catches mistakes at compile time.

## Packages

| Package | Description |
|---------|-------------|
| `@llui/core` | Runtime — component, mount, scope tree, bindings, structural primitives, element helpers |
| `@llui/vite-plugin` | Compiler — 3-pass TypeScript transform via Vite plugin |
| `@llui/test` | Test harness — testComponent, assertEffects, propertyTest, replayTrace |
| `@llui/effects` | Effect builders — http, cancel, debounce, sequence, race |
| `@llui/ark` | Ark UI adapter — headless components via Zag.js state machines |
| `@llui/vike` | Vike adapter — SSR, SSG, routing |

## Development

```bash
pnpm install
pnpm turbo build
pnpm turbo test
pnpm turbo check
pnpm turbo lint
```

See [ROADMAP.md](ROADMAP.md) for implementation status.
