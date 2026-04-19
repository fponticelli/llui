# @llui/dom

Runtime for the [LLui](https://github.com/fponticelli/llui) web framework — The Elm Architecture with compile-time bitmask optimization.

No virtual DOM. `view()` runs once at mount, building real DOM nodes with reactive bindings that update surgically when state changes.

## Install

```bash
pnpm add @llui/dom
```

## Quick Start

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
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text((s) => String(s.count)),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

## View<S, M> — the helper bundle

`view` receives a single `View<S, M>` bag. Destructure what you need — `send` plus any state-bound helpers. TypeScript infers `S` from the component definition, so no per-call generics:

```typescript
view: ({ send, text, show, each, branch, memo }) => [
  text(s => s.label),                    // s is State — inferred
  ...show({ when: s => s.visible, render: () => [...] }),
  ...each({ items: s => s.items, key: i => i.id, render: ({ item }) => [...] }),
]
```

Element helpers (`div`, `button`, `span`, etc.) stay as imports — they're stateless and don't need the `S` binding.

## API

### Core

| Export                         | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `component(def)`               | Create a component definition                             |
| `mountApp(el, def)`            | Mount a component to a DOM element                        |
| `hydrateApp(el, def)`          | Hydrate server-rendered HTML                              |
| `mountAtAnchor(anchor, def)`   | Mount a component relative to a comment anchor            |
| `hydrateAtAnchor(anchor, def)` | Hydrate server-rendered HTML relative to a comment anchor |
| `flush()`                      | Synchronously flush all pending updates                   |
| `createView(send)`             | Create a full View bundle (for tests/dynamic use)         |

### View Primitives

| Primitive                          | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `text(accessor)`                   | Reactive text node                            |
| `show({ when, render })`           | Conditional rendering                         |
| `branch({ on, cases, default? })`  | Multi-case switching with optional default    |
| `scope({ on, render })`            | Keyed subtree rebuild on key change           |
| `each({ items, key, render })`     | Keyed list rendering                          |
| `portal({ target, render })`       | Render into a different DOM location          |
| `child({ def, key, props })`       | Full component boundary (Level 2 composition) |
| `memo(accessor)`                   | Memoized derived value                        |
| `sample(selector)`                 | One-shot imperative state read (no binding)   |
| `selector(field)`                  | O(1) one-of-N selection binding               |
| `onMount(callback)`                | Lifecycle hook (runs once after mount)        |
| `errorBoundary(opts)`              | Catch render errors                           |
| `foreign({ create, update })`      | Integrate non-LLui libraries                  |
| `clientOnly({ render, fallback })` | Browser-only subtree (skipped during SSR)     |
| `slice(h, selector)`               | View over a sub-slice of state                |

### Composition

| Export                                    | Purpose                          |
| ----------------------------------------- | -------------------------------- |
| `mergeHandlers(...handlers)`              | Combine multiple update handlers |
| `sliceHandler({ get, set, narrow, sub })` | Route messages to a state slice  |

### Context

| Export                             | Purpose                  |
| ---------------------------------- | ------------------------ |
| `createContext(defaultValue)`      | Create a context         |
| `provide(ctx, accessor, children)` | Provide value to subtree |
| `useContext(ctx)`                  | Read context value       |

### Element Helpers

50+ typed element constructors: `div`, `span`, `button`, `input`, `a`, `h1`-`h6`, `table`, `tr`, `td`, `ul`, `li`, `img`, `form`, `label`, `select`, `textarea`, `canvas`, `video`, `nav`, `header`, `footer`, `section`, `article`, `p`, `pre`, `code`, and more.

### SSR

| Export                            | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `renderToString(def, state, env)` | Render component to HTML string (requires an env from a sub-entry)     |
| `renderNodes(def, state, env)`    | Render to DOM nodes + instance for layout composition                  |
| `browserEnv()`                    | Wrap the browser globals as a `DomEnv` (default for `mountApp`)        |
| `jsdomEnv()` / `linkedomEnv()`    | Construct per-call SSR envs (from `@llui/dom/ssr/jsdom` / `/linkedom`) |

## Sub-path Exports

```typescript
import { installDevTools } from '@llui/dom/devtools' // dev-only, tree-shaken
import { renderToString } from '@llui/dom/ssr' // server entry
import { jsdomEnv } from '@llui/dom/ssr/jsdom' // jsdom-backed DomEnv
import { linkedomEnv } from '@llui/dom/ssr/linkedom' // linkedom-backed (Workers)
import { replaceComponent } from '@llui/dom/hmr' // HMR support
```

## Performance

Competitive with Solid and Svelte on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark). 5.8 KB gzipped.
