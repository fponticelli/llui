---
title: LLui
description: A compile-time-optimized web framework built on The Elm Architecture, designed for LLM-first authoring.
---

## No virtual DOM. Effects as data. Compile-time bitmask optimization.

LLui is a web framework where `view()` runs once — DOM nodes are created at mount time with reactive bindings that update surgically when state changes.

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

| Package | Description |
|---|---|
| [`@llui/dom`](/api/dom) | Runtime — component, mount, scope tree, bindings, structural primitives, element helpers |
| [`@llui/vite-plugin`](/api/vite-plugin) | Compiler — 3-pass TypeScript transform, template cloning, source maps |
| [`@llui/effects`](/api/effects) | Effect system — http, cancel, debounce, sequence, race, websocket, retry, upload |
| [`@llui/router`](/api/router) | Routing — structured path matching, history/hash mode, guards, link helper |
| [`@llui/transitions`](/api/transitions) | Animation helpers — `transition()`, `fade`, `slide`, `scale`, `collapse`, `flip`, `spring` |
| [`@llui/components`](/api/components) | 54 headless components + opt-in theme (CSS tokens, dark mode, Tailwind class helpers) |
| [`@llui/test`](/api/test) | Test harness — testComponent, testView, propertyTest, replayTrace |
| [`@llui/vike`](/api/vike) | Vike SSR/SSG adapter — onRenderHtml, onRenderClient |
| [`@llui/mcp`](/api/mcp) | MCP server — LLM debug tools via Model Context Protocol |
| [`@llui/lint-idiomatic`](/api/lint-idiomatic) | Linter — 15 anti-pattern rules for idiomatic LLui |

## Performance

Competitive with Solid and Svelte on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark):

| Operation | LLui | Solid | Svelte | vanilla |
|---|---:|---:|---:|---:|
| Create 1k | ~24ms | 23ms | 23ms | 22ms |
| Update 10th | ~11ms | 11ms | 12ms | 10ms |
| Select | ~4ms | 6ms | 5ms | 3ms |
| Swap | ~13ms | 14ms | 14ms | 12ms |
| Clear 1k | ~11ms | 11ms | 11ms | 9ms |
| Bundle (gzip) | **5.8 KB** | 4.7 KB | 4.3 KB | — |

## Quick Start

```bash
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom @llui/effects
npm install -D @llui/vite-plugin vite typescript
npx vite
```

## For LLMs

- [llms.txt](/llms.txt) — concise framework reference
- [llms-full.txt](/llms-full.txt) — comprehensive reference (all APIs, patterns, rules)
- [LLM Guide](/llm-guide) — system prompt and idiomatic patterns
