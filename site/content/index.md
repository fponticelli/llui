---
title: LLui
description: A compile-time-optimized web framework built on The Elm Architecture, designed for LLM-first authoring.
---

## The web framework designed for LLMs

LLui is the first web framework built from the ground up for AI-assisted development. Its architecture — strict types, pure functions, effects as data, and a flat component model — maps directly to how LLMs reason about code.

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

## Why LLMs produce better LLui code

**One pattern for everything.** Every component is `init` → `update` → `view`. No hooks, no lifecycle methods, no class hierarchies, no context providers. An LLM that understands one component understands them all.

**Pure functions are predictable.** `update(state, msg)` is a pure function — given the same state and message, it always returns the same result. LLMs don't need to reason about mutation, timing, or hidden side effects. They just pattern-match on message types.

**Types constrain the output.** `State`, `Msg`, and `Effect` are explicit discriminated unions. The type system rejects invalid states at compile time. An LLM can't accidentally produce a component that sends the wrong message or forgets to handle a case — TypeScript catches it.

**Effects as data, not callbacks.** Side effects are plain objects returned from `update()`, not imperative calls scattered through the code. An LLM can reason about what a component _does_ by reading its return values. Testing is just `deepEqual` on the effect array.

**No hidden runtime magic.** `view()` runs once. There's no virtual DOM diffing, no dependency tracking, no re-rendering. Reactive bindings are explicit arrow functions: `text((s) => s.count)`. An LLM can see exactly which state drives which DOM node.

**Flat composition.** Components compose via view functions (state slice + send), not through nested provider trees. There's one level of indirection, not five. LLMs can follow the data flow in a single pass.

## How it works

- **`view()` runs once.** DOM nodes are created at mount time with reactive bindings that update surgically when state changes. No re-rendering.
- **Two-phase update.** Phase 1 reconciles structural changes (`branch`, `each`, `show`). Phase 2 iterates a flat binding array with bitmask gating — `(mask & dirty) === 0` skips irrelevant updates in constant time.
- **Compiler optimization.** The Vite plugin extracts state access paths, assigns bitmask bits, and synthesizes `__dirty()` per component. Zero runtime dependency tracking overhead.

## LLM integration

LLui provides first-class tooling for AI workflows:

- **[llms.txt](/llms.txt)** — concise framework reference for system prompts
- **[llms-full.txt](/llms-full.txt)** — comprehensive reference with all APIs, patterns, and rules (~47KB, fits in most context windows)
- **[@llui/mcp](/api/mcp)** — MCP server exposing debug tools directly to LLMs via Model Context Protocol
- **[@llui/lint-idiomatic](/api/lint-idiomatic)** — 15 anti-pattern rules that catch common LLM mistakes before they reach production
- **[LLM Guide](/llm-guide)** — system prompt and idiomatic patterns for AI code generation

## Packages

| Package                                       | Description                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`@llui/dom`](/api/dom)                       | Runtime — component, mount, scope tree, bindings, structural primitives, element helpers   |
| [`@llui/vite-plugin`](/api/vite-plugin)       | Compiler — 3-pass TypeScript transform, template cloning, source maps                      |
| [`@llui/effects`](/api/effects)               | Effect system — http, cancel, debounce, sequence, race, websocket, retry, upload           |
| [`@llui/router`](/api/router)                 | Routing — structured path matching, history/hash mode, guards, link helper                 |
| [`@llui/transitions`](/api/transitions)       | Animation helpers — `transition()`, `fade`, `slide`, `scale`, `collapse`, `flip`, `spring` |
| [`@llui/components`](/api/components)         | 54 headless components + opt-in theme (CSS tokens, dark mode, Tailwind class helpers)      |
| [`@llui/test`](/api/test)                     | Test harness — testComponent, testView, propertyTest, replayTrace                          |
| [`@llui/vike`](/api/vike)                     | Vike SSR/SSG adapter — onRenderHtml, onRenderClient                                        |
| [`@llui/mcp`](/api/mcp)                       | MCP server — LLM debug tools via Model Context Protocol                                    |
| [`@llui/lint-idiomatic`](/api/lint-idiomatic) | Linter — 15 anti-pattern rules for idiomatic LLui                                          |

## Performance

Beats Solid on 7 of 9 benchmarks, beats Svelte on 7 of 9 on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark):

| Operation     |       LLui |   Solid |  Svelte | vanilla |
| ------------- | ---------: | ------: | ------: | ------: |
| Create 1k     |     23.4ms |  23.5ms |  23.4ms |  22.8ms |
| Replace 1k    |     24.9ms |  25.6ms |  25.8ms |  23.7ms |
| Update 10th   |     13.2ms |  13.3ms |  14.3ms |  13.0ms |
| Select        |  **3.0ms** |   3.9ms |   5.6ms |   6.1ms |
| Swap          |  **9.6ms** |  16.1ms |  15.7ms |  14.2ms |
| Remove        |     11.2ms |  11.5ms |  12.8ms |  13.2ms |
| Create 10k    |    232.3ms | 232.1ms | 233.9ms | 218.4ms |
| Append 1k     |     27.7ms |  26.8ms |  27.0ms |  25.9ms |
| Clear         |     12.0ms |  11.6ms |  11.2ms |   9.3ms |
| Bundle (gzip) | **7.4 KB** |  4.5 KB | 12.2 KB |  2.5 KB |

## Quick Start

```bash
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom @llui/effects
npm install -D @llui/vite-plugin vite typescript
npx vite
```
