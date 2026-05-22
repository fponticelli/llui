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
// @doc-skip — illustrative shape; uses `[...]` placeholders for render results
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

| Primitive                          | Purpose                                     |
| ---------------------------------- | ------------------------------------------- |
| `text(accessor)`                   | Reactive text node                          |
| `show({ when, render })`           | Conditional rendering                       |
| `branch({ on, cases, default? })`  | Multi-case switching with optional default  |
| `scope({ on, render })`            | Keyed subtree rebuild on key change         |
| `each({ items, key, render })`     | Keyed list rendering                        |
| `portal({ target, render })`       | Render into a different DOM location        |
| `memo(accessor)`                   | Memoized derived value                      |
| `sample(selector)`                 | One-shot imperative state read (no binding) |
| `selector(field)`                  | O(1) one-of-N selection binding             |
| `onMount(callback)`                | Lifecycle hook (runs once after mount)      |
| `errorBoundary(opts)`              | Catch render errors                         |
| `foreign({ create, update })`      | Integrate non-LLui libraries                |
| `clientOnly({ render, fallback })` | Browser-only subtree (skipped during SSR)   |
| `slice(h, selector)`               | View over a sub-slice of state              |

### Composition

| Export                                      | Purpose                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `combine({ slice: reducer, ... }, top?)`    | Compose slice reducers by `${slice}/${action}` message-prefix routing   |
| `mergeHandlers(...handlers)`                | Combine multiple update handlers                                        |
| `sliceHandler({ get, set, narrow, sub })`   | Route messages to a state slice                                         |
| `subApp({ reason, def, data?, onHandle? })` | Embed an isolated TEA loop (escape hatch — requires non-empty `reason`) |

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

## Common patterns

Three shapes that the Counter quick-start doesn't show but that every real app reaches for. Build the wrong shape and the symptom is "the UI froze, my `update()` doesn't seem to take effect" — actually an accessor threw during reconcile and the dev console has the real error. Build the right shape and you skip an hour of debugging.

### Reading state in an event handler

Event handlers run AFTER mount, with no active render context. `h.sample(...)` and the other view primitives throw if you call them from inside `onClick` / `onInput` / etc. The runtime error names the trap explicitly, but the right pattern is to capture the value AT RENDER TIME — `sample` is legal there, because the render IS the construction phase.

```typescript
// @doc-skip — before/after pairs; the first form intentionally throws.
// ❌ throws: [LLui] sample() can only be called inside a component's view() function
button({ onClick: () => send({ type: 'select', id: h.sample((s) => s.id) }) })

// ✅ capture at render time; the captured value is the value at the moment
//    this view ran. Subsequent state changes don't update `id` — but you're
//    in an event handler, so "at click time" is what you want anyway.
const id = h.sample((s) => s.id)
button({ onClick: () => send({ type: 'select', id }) })

// ✅ for the rare case where the handler genuinely needs *current* state
//    that wasn't knowable at render time, use the mount handle:
const handle = mountApp(container, App)
button({
  onClick: () => {
    const current = handle.getState()
    send({ type: 'select', id: current.id })
  },
})
```

### Iterating a normalized record + reading nested per-item fields

A `Record<id, Entity>` store iterated via `each` is idiomatic TEA. The trap: writing `item.current().field.nested` repeatedly inside the render falls back to a wide bitmask (the compiler can't trace through the `.current()` call to know which state path you read) and fires on every update. Plus, the chained access throws on any commit where the row hasn't been reconciled yet but a parent binding re-fired.

```typescript
// @doc-skip — before/after pairs with illustrative types.
interface Entity {
  id: string
  facts: Record<string, Fact>
}
interface State {
  entities: Record<string, Entity>
}

// ❌ FULL_MASK + repeated .current() calls, hard to read, throws if
//    item.current() is transiently undefined during a reconcile race
h.each<Entity>({
  items: (s) => Object.values(s.entities),
  key: (e) => e.id,
  render: ({ item }) => [
    li([
      h.text(() => item.current().facts.name?.value ?? ''),
      h.text(() => item.current().facts.population?.value ?? ''),
    ]),
  ],
})

// ✅ destructure `item.current()` once at the top of the accessor, so
//    one read covers the whole render and the bitmask stays narrow
h.each<Entity>({
  items: (s) => Object.values(s.entities),
  key: (e) => e.id,
  render: ({ item }) => [
    li([
      h.text(() => {
        const e = item.current()
        return e.facts.name?.value ?? ''
      }),
      h.text(() => {
        const e = item.current()
        return e.facts.population?.value ?? ''
      }),
    ]),
  ],
})

// ✅✅ for entities with a stable shape, project to a row type in
//     `items` so per-cell accessors are simple field reads on the row.
//     The compiler can pin a precise mask on each cell.
h.each<{ id: string; name: string; population: number | null }>({
  items: (s) =>
    Object.values(s.entities).map((e) => ({
      id: e.id,
      name: e.facts.name?.value ?? '',
      population: e.facts.population?.value ?? null,
    })),
  key: (r) => r.id,
  render: ({ item }) => [
    li([
      h.text(item.name), // shorthand: reactive, narrow mask
      h.text(() => String(item.current().population ?? '—')),
    ]),
  ],
})
```

### Forcing a remount on identity change

`branch` reconciles by case key. `branch({ on: s => s.route.name, cases: { entity: ..., list: ... } })` stays mounted across navigations between different entities (`entity:A` → `entity:B`) because the case key (`'entity'`) doesn't change. Bindings inside the case that captured the OLD entity id at render-time keep firing against the old id.

Wrap with `scope` keyed on the identity that should force a remount:

```typescript
// @doc-skip — before/after pairs; the spread is shown bare for
//   illustration but only valid inside a view's `[...]` children list.
// ❌ stale bindings across entity:A → entity:B
...h.branch({
  on: (s) => s.route.name,
  cases: { entity: () => [viewEntity(h)], list: () => [viewList(h)] },
})

// ✅ scope's key includes the entity id, so navigating between entities
//    triggers a full remount of the entity view — every binding inside is
//    fresh and captures the current entity id
...h.scope({
  on: (s) => s.route.name === 'entity' ? `entity:${s.route.entityId}` : 'list',
  render: (sub) => [
    ...sub.branch({
      on: (s) => s.route.name,
      cases: { entity: () => [viewEntity(sub)], list: () => [viewList(sub)] },
    }),
  ],
})
```

### Global keyboard shortcuts (and other document-level listeners)

`document.addEventListener` belongs in an effect. The effect's `signal: AbortSignal` is wired to the component's lifetime — adding a listener with the signal as `{ signal }` automatically removes it when the component unmounts.

```typescript
interface Effect {
  kind: 'bind-keyboard'
}

function onEffect({
  effect,
  send,
  signal,
}: {
  effect: Effect
  send: (m: Msg) => void
  signal: AbortSignal
}): void {
  if (effect.kind === 'bind-keyboard') {
    if (typeof document === 'undefined') return
    document.addEventListener(
      'keydown',
      (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault()
          send({ type: 'open-palette' })
        }
      },
      { signal },
    )
  }
}
```

Fire the effect at init: `init: () => [{ ... }, [{ kind: 'bind-keyboard' }]]`.

### When an accessor throws

LLui's structural reconcile + binding pipeline can't repair a thrown accessor — a partial DOM mutation is left in place. In **dev mode**, the runtime queues a panic that re-throws on the NEXT commit so you see a hard error with the original throw's stack and the active accessor's label. In **production**, the runtime logs the throw via `console.error` and continues so one bad accessor doesn't brick the whole app.

If you want full control — surface errors via Sentry, render an error boundary, etc. — install a hook via the mount handle:

```typescript
const handle = mountApp(container, App)
handle.setOnBindingError((info) => {
  // info: { kind, key?, message, stack? }
  Sentry.captureException(new Error(info.message), { extra: { stack: info.stack } })
})
```

Installing the hook disables the dev panic — the hook takes responsibility for the error.

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
