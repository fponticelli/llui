# LLui

A compile-time-optimized web framework built on [The Elm Architecture](https://guide.elm-lang.org/architecture/), designed for LLM-first authoring.

**No virtual DOM. Effects as data. Compile-time bitmask optimization.**

```typescript
import { component, mountApp, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: state.count - 1 }, []]
    }
  },
  view: (send) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

## Key Ideas

- **`view()` runs once.** No re-rendering. DOM nodes are created at mount time with reactive bindings that update surgically when state changes.
- **Two-phase update.** Phase 1 reconciles structural changes (`branch`, `each`, `show`). Phase 2 iterates a flat binding array with bitmask gating — `(mask & dirty) === 0` skips irrelevant updates in constant time.
- **Effects as data.** `update()` is pure — side effects are plain objects returned alongside state, dispatched by the runtime. Testable with `deepEqual`.
- **Compiler optimization.** The Vite plugin extracts state access paths, assigns bitmask bits, and synthesizes `__dirty()` per component. Zero runtime dependency tracking overhead.

## Packages

| Package                                           | Description                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@llui/dom`](packages/dom)                       | Runtime — component, mount, scope tree, bindings, structural primitives, element helpers            |
| [`@llui/vite-plugin`](packages/vite-plugin)       | Compiler — 3-pass TypeScript transform, template cloning, source maps                               |
| [`@llui/effects`](packages/effects)               | Effect system — http, cancel, debounce, sequence, race + `Async<T,E>`, `ApiError`                   |
| [`@llui/router`](packages/router)                 | Routing — structured path matching, history/hash mode, link helper                                  |
| [`@llui/transitions`](packages/transitions)       | Animation helpers for `branch`/`show`/`each` — `transition()`, `fade`, `slide`, `scale`, `collapse` |
| [`@llui/test`](packages/test)                     | Test harness — testComponent, testView, propertyTest, replayTrace                                   |
| [`@llui/vike`](packages/vike)                     | Vike SSR adapter — onRenderHtml, onRenderClient                                                     |
| [`@llui/mcp`](packages/mcp)                       | MCP server — LLM debug tools via Model Context Protocol                                             |
| [`@llui/lint-idiomatic`](packages/lint-idiomatic) | Linter — 6 anti-pattern rules for idiomatic LLui                                                    |

## Quick Start

```bash
# Create a new project
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom @llui/effects
npm install -D @llui/vite-plugin vite typescript

# Create vite.config.ts
cat > vite.config.ts << 'EOF'
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
export default defineConfig({ plugins: [llui()] })
EOF

# Create index.html
cat > index.html << 'EOF'
<!DOCTYPE html>
<html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>
EOF

# Create src/main.ts with your component
npx vite
```

## Documentation

- [Getting Started](docs/getting-started.md) — first component, project setup, basic patterns
- [Cookbook](docs/cookbook.md) — forms, async, lists, routing, composition, SSR
- [Design Documents](docs/designs/) — architecture, compiler, runtime, performance
- [API Reference](docs/designs/09%20API%20Reference.md) — type signatures for all exports
- [Roadmap](ROADMAP.md) — implementation status

## Development

```bash
pnpm install
pnpm turbo build          # Build all packages
pnpm turbo test           # Run 349 tests across 8 packages
pnpm turbo check          # Type-check
pnpm turbo lint           # ESLint
pnpm -w run bench         # js-framework-benchmark
```

## Performance

Competitive with Solid and Svelte on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark):

| Operation     |       LLui |  Solid |  Svelte |   React |
| ------------- | ---------: | -----: | ------: | ------: |
| Create 1k     |      ~25ms |   23ms |    23ms |    27ms |
| Update 10th   |      ~14ms |   14ms |    15ms |    17ms |
| Select        |       ~4ms |    4ms |     6ms |     6ms |
| Swap          |      ~14ms |   17ms |    17ms |   107ms |
| Bundle (gzip) | **4.0 KB** | 4.8 KB | 13.6 KB | 61.3 KB |

## License

MIT
