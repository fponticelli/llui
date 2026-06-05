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

- **`view()` runs once.** No re-rendering. DOM nodes are created at mount time with reactive bindings that update surgically when state changes. Everything you build (`el`/`text`/`each`/`show`/`branch`/…) is a lazy `Mountable`, materialized where it's placed.
- **Chunked-mask reactivity.** Each binding carries a sparse mask of the dependency-path chunks it reads; on update the runtime computes the dirty chunk-set from old→new state and commits only the bindings whose mask intersects it. No path ceiling. Structural primitives (`branch`, `each`, `show`) reconcile arms/keyed rows and own child scopes.
- **Effects as data.** `update()` is pure — side effects are plain objects returned alongside state, dispatched by the runtime. Testable with `deepEqual`.
- **Compiler optimization.** The Vite plugin runs the signal transform — lowering signal expressions in a component's view to runtime helpers and surfacing the framework lint rules as non-bypassable build errors. Dependency paths are derived statically from the signal reads.

## Packages

| Package                                                           | Description                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@llui/dom`](packages/dom)                                       | Runtime — component, mount, scope tree, bindings, structural primitives, HTML/SVG/MathML helpers    |
| [`@llui/compiler`](packages/compiler)                             | Engine — 3-pass TypeScript transform + 41 compile-time lint rules (all error severity)              |
| [`@llui/vite-plugin`](packages/vite-plugin)                       | Vite adapter — wires the compiler into Vite, surfaces diagnostics via `this.error()`                |
| [`@llui/compiler-introspection`](packages/compiler-introspection) | Opt-in compiler module — agent schemas, msg annotations, schema hash emission                       |
| [`@llui/compiler-devtools`](packages/compiler-devtools)           | Opt-in compiler module — `__componentMeta` emission for source navigation                           |
| [`@llui/compiler-ssr`](packages/compiler-ssr)                     | Opt-in compiler module — `'use client'` directive handling and SSR emission                         |
| [`@llui/effects`](packages/effects)                               | Effect system — http, cancel, debounce, sequence, race + `Async<T,E>`, `ApiError`                   |
| [`@llui/router`](packages/router)                                 | Routing — structured path matching, history/hash mode, link helper                                  |
| [`@llui/transitions`](packages/transitions)                       | Animation helpers for `branch`/`show`/`each` — `transition()`, `fade`, `slide`, `scale`, `collapse` |
| [`@llui/components`](packages/components)                         | 58 headless components + locale i18n + format utilities + Standard Schema forms + opt-in theme      |
| [`@llui/test`](packages/test)                                     | Test harness — testComponent, testView, propertyTest, replayTrace                                   |
| [`@llui/vike`](packages/vike)                                     | Vike SSR adapter — onRenderHtml, onRenderClient                                                     |
| [`@llui/mcp`](packages/mcp)                                       | MCP server — LLM debug tools via Model Context Protocol                                             |
| [`@llui/agent`](packages/agent)                                   | LAP server + browser client runtime for driving LLui apps from LLM clients                          |
| [`llui-agent`](packages/agent-bridge)                             | MCP CLI bridging Claude / other LLM clients to a running `@llui/agent` server                       |

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

Top-tier on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest), and **leading the framework field on fine-grained streaming updates** (a custom "ticker" suite). Median of 5 runs, same machine.

**Standard suite** — within a few percent of Solid/Svelte; fastest on Select:

| Operation     |      LLui |   Solid |  Svelte | vanilla |
| ------------- | --------: | ------: | ------: | ------: |
| Create 1k     |    21.6ms |  20.7ms |  20.9ms |  20.1ms |
| Replace 1k    |    23.8ms |  23.1ms |  23.7ms |  21.7ms |
| Update 10th   |    11.6ms |  11.4ms |  12.0ms |  10.8ms |
| Select        | **2.7ms** |   3.4ms |   5.0ms |   2.7ms |
| Swap          |    14.4ms |  14.0ms |  14.0ms |  12.4ms |
| Remove        |    10.8ms |  10.2ms |  10.3ms |   9.7ms |
| Create 10k    |   227.9ms | 216.8ms | 218.6ms | 200.0ms |
| Append 1k     |    26.1ms |  23.5ms |  23.5ms |  23.1ms |
| Clear         |    10.3ms |  11.0ms |  10.7ms |   8.9ms |
| Bundle (gzip) |    8.2 KB |  4.5 KB | 12.2 KB |  2.5 KB |

**Ticker suite** (streaming partial-list updates) — LLui beats every other framework on every op; trails only hand-written vanilla on bulk construction:

| Operation             |       LLui |  Solid | Svelte |  React | vanilla |
| --------------------- | ---------: | -----: | -----: | -----: | ------: |
| Mount 200             |  **5.6ms** |  6.1ms |  6.5ms |  5.8ms |   5.8ms |
| 100 ticks             |  **4.8ms** |  5.5ms |  5.8ms |  9.3ms |   4.0ms |
| Burst 1k              | **15.9ms** | 21.8ms | 24.5ms | 52.6ms |   9.5ms |
| Toggle mode (fan-out) |  **3.2ms** |  3.2ms |  3.4ms |  3.6ms |   3.1ms |
| Churn 50              |  **4.2ms** |  4.4ms |  4.7ms |  4.4ms |   4.0ms |
| Clear                 |  **1.1ms** |  1.2ms |  1.3ms |  1.3ms |   1.2ms |
