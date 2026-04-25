# LLui

A compile-time-optimized web framework built on [The Elm Architecture](https://guide.elm-lang.org/architecture/), designed for LLM-first authoring.

**No virtual DOM. Effects as data. Compile-time bitmask optimization.**

```typescript
import { component, mountApp, div, button } from '@llui/dom'

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
  view: ({ send, text }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
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

| Package                                              | Description                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@llui/dom`](packages/dom)                          | Runtime — component, mount, scope tree, bindings, structural primitives, HTML/SVG/MathML helpers    |
| [`@llui/vite-plugin`](packages/vite-plugin)          | Compiler — 3-pass TypeScript transform, template cloning, source maps                               |
| [`@llui/effects`](packages/effects)                  | Effect system — http, cancel, debounce, sequence, race + `Async<T,E>`, `ApiError`                   |
| [`@llui/router`](packages/router)                    | Routing — structured path matching, history/hash mode, link helper                                  |
| [`@llui/transitions`](packages/transitions)          | Animation helpers for `branch`/`show`/`each` — `transition()`, `fade`, `slide`, `scale`, `collapse` |
| [`@llui/components`](packages/components)            | 58 headless components + locale i18n + format utilities + Standard Schema forms + opt-in theme      |
| [`@llui/test`](packages/test)                        | Test harness — testComponent, testView, propertyTest, replayTrace                                   |
| [`@llui/vike`](packages/vike)                        | Vike SSR adapter — onRenderHtml, onRenderClient                                                     |
| [`@llui/mcp`](packages/mcp)                          | MCP server — LLM debug tools via Model Context Protocol                                             |
| [`@llui/eslint-plugin`](packages/eslint-plugin-llui) | ESLint plugin — 21 anti-pattern rules that catch common LLM mistakes                                |
| [`@llui/agent`](packages/agent)                      | LAP server + browser client runtime for driving LLui apps from LLM clients                          |
| [`llui-agent`](packages/agent-bridge)                | MCP CLI bridging Claude / other LLM clients to a running `@llui/agent` server                       |

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

## Development

```bash
pnpm install
pnpm turbo build          # Build all packages
pnpm turbo test           # Run 1200+ tests across all packages
pnpm turbo check          # Type-check
pnpm turbo lint           # ESLint
pnpm bench:setup          # One-time: clone + compile js-framework-benchmark
pnpm bench                # Run LLui benchmark (add --save to update baseline)
```

## Performance

Top-tier performance on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), competitive with Solid and Svelte:

| Operation     |       LLui |   Solid |  Svelte | vanilla |
| ------------- | ---------: | ------: | ------: | ------: |
| Create 1k     | **22.3ms** |  23.5ms |  23.4ms |  22.8ms |
| Replace 1k    |     24.9ms |  25.6ms |  25.8ms |  23.7ms |
| Update 10th   |     13.2ms |  13.3ms |  14.3ms |  13.0ms |
| Select        |  **3.0ms** |   3.9ms |   5.6ms |   6.1ms |
| Swap          |  **9.6ms** |  16.1ms |  15.7ms |  14.2ms |
| Remove        |     11.2ms |  11.5ms |  12.8ms |  13.2ms |
| Create 10k    |    232.3ms | 232.1ms | 233.9ms | 218.4ms |
| Append 1k     |     27.7ms |  26.8ms |  27.0ms |  25.9ms |
| Clear         |     12.0ms |  11.6ms |  11.2ms |   9.3ms |
| Bundle (gzip) | **7.4 KB** |  4.5 KB | 12.2 KB |  2.5 KB |
