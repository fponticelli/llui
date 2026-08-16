# LLui

A compile-time-optimized web framework built on [The Elm Architecture](https://guide.elm-lang.org/architecture/), designed for LLM-first authoring.

**No virtual DOM. Effects as data. Compile-time chunked-mask optimization.**

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
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
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

| Package                                               | Description                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@llui/dom`](packages/dom)                           | Runtime — component, mount, scope tree, bindings, structural primitives, HTML/SVG/MathML helpers                                                                       |
| [`@llui/compiler`](packages/compiler)                 | Engine — signal TypeScript transform (view lowering) + compile-time lint rules (all error severity)                                                                    |
| [`@llui/vite-plugin`](packages/vite-plugin)           | Vite adapter — wires the compiler into Vite, surfaces diagnostics via `this.error()`                                                                                   |
| [`@llui/compiler-ssr`](packages/compiler-ssr)         | Opt-in compiler module — `'use client'` directive handling and SSR emission                                                                                            |
| [`@llui/effects`](packages/effects)                   | Effect system — http, cancel, debounce, sequence, race + `Async<T,E>`, `ApiError`                                                                                      |
| [`@llui/router`](packages/router)                     | Routing — named type-safe routes, Standard Schema codecs, history/hash mode, link helper                                                                               |
| [`@llui/transitions`](packages/transitions)           | Animation helpers for `branch`/`show`/`each` — `transition()`, `fade`, `slide`, `scale`, `collapse`                                                                    |
| [`@llui/components`](packages/components)             | 66 headless components + locale i18n + format utilities + Standard Schema forms + opt-in theme                                                                         |
| [`@llui/interactions`](packages/interactions)         | Standalone focus, dismissal, floating-positioning, modal-isolation, scroll-lock, direction, and roving-focus primitives                                                |
| [`@llui/test`](packages/test)                         | Test harness — testComponent, testView, propertyTest, replayTrace                                                                                                      |
| [`@llui/security`](packages/security)                 | Shared URL + loopback-origin sanitization for the DOM-sink and dev-server security surfaces                                                                            |
| [`@llui/vike`](packages/vike)                         | Vike SSR adapter — onRenderHtml, onRenderClient                                                                                                                        |
| [`@llui/mcp`](packages/mcp)                           | MCP server — LLM debug tools via Model Context Protocol                                                                                                                |
| [`@llui/agent`](packages/agent)                       | LAP server + browser client runtime for driving LLui apps from LLM clients                                                                                             |
| [`llui-agent`](packages/agent-bridge)                 | MCP CLI bridging Claude / other LLM clients to a running `@llui/agent` server                                                                                          |
| [`@llui/devmode-annotate`](packages/devmode-annotate) | Dev-mode HUD — capture annotated notes from a running app into the shared notebook for the LLM                                                                         |
| [`@llui/notes-format`](packages/notes-format)         | Devmode notebook on-disk format — note types + filename/slug/session helpers + YAML (de)serialization                                                                  |
| [`@llui/a2ui`](packages/a2ui)                         | Renderer for Google's A2UI protocol — applies server→client envelopes to a reactive TEA surface (`{path}` bindings, templates, two-way inputs, actions, open catalog)  |
| [`@llui/markdown`](packages/markdown)                 | Reactive Markdown rendering — `markdown()` parses to mdast and builds live reactive DOM (no HTML string), per-node renderer overrides, streaming-friendly keyed blocks |
| [`@llui/lexical`](packages/lexical)                   | Low-level Lexical ↔ signal-runtime binding — `lexicalForeign` seam, plugin contract, decorator bridge                                                                  |
| [`@llui/lexical-collab`](packages/lexical-collab)     | Opt-in collaborative editing — `yjsCollab` over an injected Yjs provider: CRDT sync, scoped undo, presence                                                             |
| [`@llui/markdown-editor`](packages/markdown-editor)   | WYSIWYG Markdown editor — `markdownEditor()` component, transformer registry, GFM/callout plugins, toolbar                                                             |

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
pnpm bench:setup          # One-time: clone + install + compile js-framework-benchmark (and build the ticker apps)
pnpm bench                # Run LLui-only diagnostics against the canonical baseline
pnpm bench:all --runs 5 --save # Replace the canonical standard+ticker baseline transactionally
pnpm bench:container -- --framework llui --runs 1 # Same runner in the pinned one-shot Docker environment
```

## Performance

LLui is measured with [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) and a custom ticker suite for fine-grained streaming updates. Results, methodology, and capture provenance are generated from the single canonical [`benchmarks/baseline.json`](benchmarks/baseline.json) document; see the [benchmark report](https://llui.dev/benchmarks) for the tables.

The currently tracked capture is explicitly marked `legacy`: its standard and ticker suites were recorded independently and do not have complete shared provenance. It is retained as historical data, not as a machine-comparable regression baseline. The next complete homelab capture will replace both suites atomically.

Authoritative captures run on demand in the [pinned benchmark container](benchmarks/container/README.md). The GitHub **Homelab benchmarks** workflow accepts exact argv as JSON, quiesces the shared runner VM for the measurement, and publishes saved results to a review branch.
