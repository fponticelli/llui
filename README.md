# LLui

A compile-time-optimized web framework built on [The Elm Architecture](https://guide.elm-lang.org/architecture/), designed for LLM-first authoring.

**No virtual DOM. Effects as data. Compile-time chunked-mask optimization.**

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

| Package                                                           | Description                                                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@llui/dom`](packages/dom)                                       | Runtime — component, mount, scope tree, bindings, structural primitives, HTML/SVG/MathML helpers                                                                       |
| [`@llui/compiler`](packages/compiler)                             | Engine — signal TypeScript transform (view lowering) + compile-time lint rules (all error severity)                                                                    |
| [`@llui/vite-plugin`](packages/vite-plugin)                       | Vite adapter — wires the compiler into Vite, surfaces diagnostics via `this.error()`                                                                                   |
| [`@llui/compiler-introspection`](packages/compiler-introspection) | Opt-in compiler module — agent schemas, msg annotations, schema hash emission                                                                                          |
| [`@llui/compiler-devtools`](packages/compiler-devtools)           | Opt-in compiler module — `__componentMeta` emission for source navigation                                                                                              |
| [`@llui/compiler-ssr`](packages/compiler-ssr)                     | Opt-in compiler module — `'use client'` directive handling and SSR emission                                                                                            |
| [`@llui/effects`](packages/effects)                               | Effect system — http, cancel, debounce, sequence, race + `Async<T,E>`, `ApiError`                                                                                      |
| [`@llui/router`](packages/router)                                 | Routing — structured path matching, history/hash mode, link helper                                                                                                     |
| [`@llui/transitions`](packages/transitions)                       | Animation helpers for `branch`/`show`/`each` — `transition()`, `fade`, `slide`, `scale`, `collapse`                                                                    |
| [`@llui/components`](packages/components)                         | 58 headless components + locale i18n + format utilities + Standard Schema forms + opt-in theme                                                                         |
| [`@llui/test`](packages/test)                                     | Test harness — testComponent, testView, propertyTest, replayTrace                                                                                                      |
| [`@llui/vike`](packages/vike)                                     | Vike SSR adapter — onRenderHtml, onRenderClient                                                                                                                        |
| [`@llui/mcp`](packages/mcp)                                       | MCP server — LLM debug tools via Model Context Protocol                                                                                                                |
| [`@llui/agent`](packages/agent)                                   | LAP server + browser client runtime for driving LLui apps from LLM clients                                                                                             |
| [`llui-agent`](packages/agent-bridge)                             | MCP CLI bridging Claude / other LLM clients to a running `@llui/agent` server                                                                                          |
| [`@llui/devmode-annotate`](packages/devmode-annotate)             | Dev-mode HUD — capture annotated notes from a running app into the shared notebook for the LLM                                                                         |
| [`@llui/markdown`](packages/markdown)                             | Reactive Markdown rendering — `markdown()` parses to mdast and builds live reactive DOM (no HTML string), per-node renderer overrides, streaming-friendly keyed blocks |
| [`@llui/lexical`](packages/lexical)                               | Low-level Lexical ↔ signal-runtime binding — `lexicalForeign` seam, plugin contract, decorator bridge                                                                  |
| [`@llui/lexical-collab`](packages/lexical-collab)                 | Opt-in collaborative editing — `yjsCollab` over an injected Yjs provider: CRDT sync, scoped undo, presence                                                             |
| [`@llui/markdown-editor`](packages/markdown-editor)               | WYSIWYG Markdown editor — `markdownEditor()` component, transformer registry, GFM/callout plugins, toolbar                                                             |

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

Full documentation lives at **[llui.dev](https://llui.dev)**:

- [Getting Started](https://llui.dev/getting-started) — first component, project setup, basic patterns
- [Cookbook](https://llui.dev/cookbook) — forms, async, lists, routing, composition, SSR
- [Architecture](https://llui.dev/architecture) — build-once views, chunked-mask reactivity, the compiler, scope tree
- [API Reference](https://llui.dev/api/dom) — type signatures for every package
- [Agents](https://llui.dev/agents) — the LLM operator protocol and JSDoc annotations

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

Top-tier on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest), and **leading the framework field on fine-grained streaming updates** (a custom "ticker" suite). All frameworks measured in one pass on the same machine (Chrome 149, headless).

**Standard suite** — within a few percent of Solid/Svelte:

| Operation     |    LLui |   Solid |  Svelte | vanilla |
| ------------- | ------: | ------: | ------: | ------: |
| Create 1k     |  21.0ms |  20.4ms |  20.5ms |  20.0ms |
| Replace 1k    |  23.9ms |  22.5ms |  23.2ms |  21.3ms |
| Update 10th   |  12.7ms |  10.8ms |  11.1ms |  11.4ms |
| Select        |   3.3ms |   3.1ms |   4.7ms |   3.3ms |
| Swap          |  16.0ms |  12.9ms |  13.2ms |  13.7ms |
| Remove        |  12.2ms |   9.7ms |   9.8ms |  10.5ms |
| Create 10k    | 229.5ms | 209.6ms | 211.4ms | 203.8ms |
| Append 1k     |  26.1ms |  22.6ms |  22.6ms |  22.6ms |
| Clear         |  11.3ms |  10.9ms |  10.0ms |   8.8ms |
| Bundle (gzip) |  8.2 KB |  4.5 KB | 12.2 KB |  2.5 KB |

**Ticker suite** (streaming partial-list updates) — LLui leads the framework field on the streaming ops (mount, ticks, bursts), and **batched bursts match hand-written vanilla**:

| Operation             |       LLui |  Solid | Svelte |  React | vanilla |
| --------------------- | ---------: | -----: | -----: | -----: | ------: |
| Mount 200             |  **5.4ms** |  5.8ms |  6.3ms |  5.5ms |   5.6ms |
| 100 ticks             |  **4.5ms** |  5.0ms |  5.6ms |  9.0ms |   3.9ms |
| Burst 1k              | **14.1ms** | 20.7ms | 23.8ms | 52.6ms |   9.6ms |
| Burst 1k (batched)    |  **5.9ms** | 11.4ms | 11.5ms |  6.1ms |   5.8ms |
| Toggle mode (fan-out) |      3.0ms |  3.0ms |  3.3ms |  3.5ms |   3.1ms |
| Churn 50              |      4.3ms |  4.1ms |  4.7ms |  4.4ms |   3.9ms |
| Clear                 |      1.1ms |  1.1ms |  1.2ms |  1.3ms |   1.1ms |
