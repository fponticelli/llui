---
title: LLui
description: A compile-time-optimized web framework built on The Elm Architecture, designed for LLM-first authoring.
---

## The web framework designed for LLMs

LLui is the first web framework built from the ground up for AI-assisted development. Its architecture — strict types, pure functions, effects as data, and a flat component model — maps directly to how LLMs reason about code.

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

## Why LLMs produce better LLui code

**One pattern for everything.** Every component is `init` → `update` → `view`. No hooks, no lifecycle methods, no class hierarchies, no context providers. An LLM that understands one component understands them all.

**Pure functions are predictable.** `update(state, msg)` is a pure function — given the same state and message, it always returns the same result. LLMs don't need to reason about mutation, timing, or hidden side effects. They just pattern-match on message types.

**Types constrain the output.** `State`, `Msg`, and `Effect` are explicit discriminated unions. The type system rejects invalid states at compile time. An LLM can't accidentally produce a component that sends the wrong message or forgets to handle a case — TypeScript catches it.

**Effects as data, not callbacks.** Side effects are plain objects returned from `update()`, not imperative calls scattered through the code. An LLM can reason about what a component _does_ by reading its return values. Testing is just `deepEqual` on the effect array.

**No hidden runtime magic.** `view()` runs once. There's no virtual DOM diffing, no re-rendering. Reactive bindings are explicit signals: `text(state.at('count').map(String))`. An LLM can see exactly which state drives which DOM node.

**Flat composition.** Components compose via view functions (a signal slice + send), not through nested provider trees. There's one level of indirection, not five. LLMs can follow the data flow in a single pass.

## How it works

- **`view()` runs once.** DOM nodes are created at mount time with reactive bindings that update surgically when state changes. No re-rendering, no virtual DOM.
- **Chunked-mask reconciliation.** When state changes, the runtime computes a dirty set by reference-equality per tracked path, then gates each binding by a sparse mask — a binding whose mask doesn't intersect the dirty set is skipped without calling its accessor. Update cost scales with what changed, not with tree size, and there is no path ceiling.
- **Compiler optimization.** The Vite plugin extracts each signal's dependency paths and lowers the common inline-view shape to allocation-free runtime calls. Zero runtime dependency-tracking overhead.

## LLM integration

LLui provides first-class tooling for AI workflows:

- **[llms.txt](/llms.txt)** — concise framework reference for system prompts
- **[llms-full.txt](/llms-full.txt)** — comprehensive reference with all APIs, patterns, and rules (~515KB, full API surface)
- **[@llui/agent](/api/agent)** — LLM-driven control surface: Claude reads state, enumerates actions, dispatches messages into the live app
- **[@llui/mcp](/api/mcp)** — MCP server exposing debug tools directly to LLMs via Model Context Protocol
- **[@llui/compiler](/api/compiler)** — compile-time error rules that catch common LLM mistakes at build time, not as lint warnings
- **[Debugging](/debugging)** — debug LLui apps interactively from the browser console or an MCP-connected LLM
- **[Agents](/agents)** — drive any LLui-built app from a Claude conversation

## Packages

| Package                                           | Description                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@llui/dom`](/api/dom)                           | Runtime — component, mount, scope tree, bindings, structural primitives, element helpers                                                                                       |
| [`@llui/compiler`](/api/compiler)                 | Engine — signal TypeScript transform + compile-time lint rules (all error severity)                                                                                            |
| [`@llui/vite-plugin`](/api/vite-plugin)           | Vite adapter — wires the compiler into Vite, surfaces diagnostics via `this.error()`                                                                                           |
| [`@llui/compiler-ssr`](/api/compiler-ssr)         | Opt-in compiler module — `'use client'` directive handling and SSR emission                                                                                                    |
| [`@llui/effects`](/api/effects)                   | Effect system — http, cancel, debounce, sequence, race, websocket, retry, upload                                                                                               |
| [`@llui/router`](/api/router)                     | Routing — structured path matching, history/hash mode, guards, link helper                                                                                                     |
| [`@llui/transitions`](/api/transitions)           | Animation helpers — `transition()`, `fade`, `slide`, `scale`, `collapse`, `flip`, `spring`                                                                                     |
| [`@llui/components`](/api/components)             | 66 headless components + opt-in theme (CSS tokens, dark mode, Tailwind class helpers)                                                                                          |
| [`@llui/test`](/api/test)                         | Test harness — testComponent, testView, propertyTest, replayTrace                                                                                                              |
| [`@llui/vike`](/api/vike)                         | Vike SSR/SSG adapter — onRenderHtml, onRenderClient                                                                                                                            |
| [`@llui/mcp`](/api/mcp)                           | MCP server — LLM debug tools via Model Context Protocol                                                                                                                        |
| [`@llui/agent`](/api/agent)                       | LLM control surface — LAP server + browser client; Claude drives the app in production                                                                                         |
| [`llui-agent`](/api/agent-bridge)                 | MCP bridge CLI — translates Claude Desktop tool calls to LAP (npm package `llui-agent`)                                                                                        |
| [`@llui/devmode-annotate`](/api/devmode-annotate) | Dev-only HUD — annotate the running app into a shared on-disk notebook the LLM reads/writes                                                                                    |
| [`@llui/notes-format`](/api/notes-format)         | Devmode notebook on-disk format — note types + filename/slug/session helpers + YAML (de)serialization                                                                          |
| [`@llui/a2ui`](/api/a2ui)                         | Renderer for Google's A2UI protocol — applies server→client envelopes to a reactive TEA surface (`{path}` bindings, templates, two-way inputs, actions, open catalog registry) |
| [`@llui/markdown`](/api/markdown)                 | Reactive Markdown rendering — `markdown()` parses to mdast, builds live reactive DOM, per-node renderer overrides, streaming-friendly keyed blocks                             |
| [`@llui/lexical`](/api/lexical)                   | Low-level Lexical ↔ signal-runtime binding — `lexicalForeign`, plugin contract, decorator bridge                                                                               |
| [`@llui/lexical-collab`](/api/lexical-collab)     | Opt-in collaborative editing — `yjsCollab` over an injected Yjs provider: CRDT sync, scoped undo, presence                                                                     |
| [`@llui/markdown-editor`](/api/markdown-editor)   | WYSIWYG Markdown editor — `markdownEditor()`, transformer registry, GFM/callout plugins, toolbar                                                                               |

## Performance

Top-tier performance on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), competitive with Solid and Svelte. [Full benchmarks →](/benchmarks)

## Quick Start

```bash
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom @llui/effects
npm install -D @llui/vite-plugin vite typescript
npx vite
```
