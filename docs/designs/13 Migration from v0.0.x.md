# Migration to the signal runtime

This doc covers how to update an app written against the legacy
mask-binding runtime (closure accessors `s => s.x`, the two-tier
`component()` / `child()` model, compiler-synthesized `__dirty` /
bitmask gating) to the current **signal runtime**.

The legacy runtime and the legacy 3-pass bitmask compiler have been
DELETED. `@llui/dom` is now the single import surface — there is no
`/signals` subpath and no `@llui/eslint-plugin`. The framework lint
rules are compile-time errors in `@llui/compiler` (surfaced through
`@llui/vite-plugin`).

## At a glance — what changed

| Legacy                                          | Signal runtime                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `view: (h: View<S,M>) => Node[]`                | `view: ({ state, send }) => readonly Node[]` (`state: Signal<S>`)    |
| Destructured helpers from the `View` bag        | Element/structural helpers are MODULE imports from `@llui/dom`       |
| Reactive read: closure `text(s => s.count)`     | Reactive read: `text(state.map(s => s.count))` / `state.at('count')` |
| `each({ items, key, render: ({item}) => … })`   | `each(state.map(s => s.items), { key, render: (item, index) => … })` |
| `each` scoped accessor `item(t => t.field)`     | `item` is a `Signal<T>`: `item.at('field')`; read with `.peek()`     |
| `show({ when, render })`                        | `show(cond, render, orElse?)`                                        |
| `branch({ on, cases })`                         | `branch(value, u => u.tag, { … })` (or 2-arg `branch(value, { … })`) |
| `init: (data: D) => [S, E[]]` (data arg)        | `init: () => S \| [S, E[]]` (NO data arg)                            |
| `onEffect: ({ effect, send, signal }) => …`     | `onEffect: (effect, { send, state }) => void \| (() => void)`        |
| `send()` microtask-batched; `flush()` to force  | `send()` applies synchronously; `flush()` is a no-op                 |
| Compiler-synthesized `__dirty` / bitmask gating | A `produce`+`deps` lowering, gated by the chunked-mask reconciler    |
| `child()` / `subApp()` / `combine()`            | View functions + plain-switch routing (no such primitives)           |
| `@llui/eslint-plugin` rules                     | `@llui/compiler` signal lint rules (compile-time errors)             |
| SSR `__renderToString` + `data-llui-hydrate`    | `renderToString` / `renderNodes` / `serializeNodes` (no markers)     |
| `hydrateApp()` (walk + attach)                  | `hydrateSignalApp()` (rebuild + atomic swap)                         |

## #1 — `view` takes `{ state, send }`; helpers are imports

The largest change. The view receives a single bag `{ state, send }`
where `state` is a `Signal<S>`. Element and structural helpers are no
longer fields on a `View` bag — they are plain imports from `@llui/dom`.
Reactive reads come from `state` via `.map(fn)` (derive) and
`.at('path')` (narrow into a sub-signal).

### Before (legacy)

```ts
export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    /* … */
  },
  view: ({ send, text, show }) =>
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
      show({ when: (s) => s.count > 0, render: () => button([text('Reset')]) }),
    ]),
})
```

### After (signal)

```ts
import { component, div, button, text, show } from '@llui/dom'

export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    /* … */
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    show(
      state.at('count').map((c) => c > 0),
      () => [button([text('Reset')])],
    ),
  ],
})
```

**What changes:**

- `view` returns an ARRAY of nodes and destructures `{ state, send }`.
- Import `div`/`button`/`text`/`show`/… from `@llui/dom`.
- Every closure accessor `s => expr` becomes a signal derivation:
  `text(s => String(s.count))` → `text(state.at('count').map(String))`
  (or `text(state.map(s => String(s.count)))`).
- Static values stay literals: `div({ class: 'container' })`.

## #2 — `each`: derive a `Signal` of the array; rows are signals

```ts
// Before — closure items + scoped accessor:
each({
  items: (s) => s.todos,
  key: (t) => t.id,
  render: ({ item }) => li([text(item.text)]),
})

// After — items is a derived Signal; item is a Signal<T>:
each(
  state.map((s) => s.todos),
  {
    key: (t) => t.id,
    render: (item) => [li([text(item.at('text'))])],
  },
)
```

- The first argument is a `Signal<readonly T[]>` (`state.map(...)` /
  `state.at(...)`), not a closure.
- `render(item, index)` receives `item: Signal<T>` and
  `index: Signal<number>`. Narrow with `item.at('field')` for a
  reactive slot; read the current value in a handler with
  `item.at('id').peek()`.
- `render` returns an array of nodes.

`virtualEach` follows the same shape, plus `itemHeight`/`containerHeight`.

## #3 — `show` / `branch` are positional

```ts
// show: condition signal, render arm (gets the NON-NULLABLE narrowed signal),
// optional else arm:
show(
  state.at('user'),
  (user) => [text(user.at('name'))], // user: Signal<NonNullable<User>>
  () => [text('signed out')],
)

// branch (discriminated union): value signal, discriminant fn, narrowed arms:
branch(state.at('route'), (r) => r.kind, {
  home: () => [homeView()],
  post: (r) => [postView(r.at('slug'))], // r narrowed to the 'post' variant
})

// branch (plain string/number key): 2-arg form, no narrowing:
branch(state.at('tab'), { code: () => [codeView()], issues: () => [issuesView()] })
```

## #4 — `init()` takes no data; effects shape

The signal `init()` takes NO argument: `init: () => S | [S, E[]]`. Where
the legacy `init(data)` consumed external data (e.g. a route loader),
the data is now supplied as the component's SEED STATE by the adapter
(see SSR below) — `init()` still runs so its effects are captured, but
its returned state is overridden.

`onEffect` is `(effect, api)` where `api` is `{ send, state }` (`state`
is a `Signal<S>`), and it may return a cleanup function. To use the
`@llui/effects` builders, bridge `handleEffects` — which returns a
`(ctx: { effect, send, signal }) => void` handler — into that shape:

```ts
import { handleEffects } from '@llui/effects'

const handler = handleEffects<Effect, Msg>()
  .use(routing.handleEffect)
  .else(({ effect, send, signal }) => {
    /* custom effect types only */
  })
const lifecycle = new AbortController()

// In the component:
onEffect: (effect, api) => handler({ effect, send: api.send, signal: lifecycle.signal })
```

`update`/`init` may return a bare `S` or a `[S, E[]]` tuple; the runtime
normalizes either form.

## #5 — `send()` is synchronous

`send(msg)` runs the reducer, reconciles the DOM, and dispatches effects
synchronously before it returns. There is no message queue and no
microtask batching. Reading the DOM immediately after `send()` already
sees the update. The handle's `flush()` is a no-op kept for harness /
agent parity — remove any `flush()` calls that existed only to force a
pending update; they are unnecessary now (calling it is harmless).

## #6 — Reactivity is `produce` + `deps`, not `__dirty`

The legacy compiler synthesized a `__dirty(old, new)` function and gated
bindings with a bitmask. The signal transform instead lowers each
reactive slot to a `produce` function plus its absolute dependency paths
(`state.at('user.name')` → deps `['user.name']`). The chunked-mask
reconciler re-runs only the bindings whose dependency paths changed and
skips the DOM write when the produced value is unchanged.

**Delete any hand-authored `__dirty`** — there is no such field on the
signal component spec. The reconciler derives gating from the lowered
deps; no user-supplied dirty function exists.

The signal lint rules replace the old correctness lint rules and are
compile-time ERRORS:

- `peek-in-slot` — `.peek()` inside a reactive slot (freezes the value).
- `operator-on-signal` — using a `Signal` as an operand; `.map(...)` its value.
- `pure-derive-body` — side effect / non-deterministic call in a `.map`/`derived` body.
- `no-node-construction-in-body` — building DOM inside a `.map`/`derived` body.

## #7 — Composition: view functions, no `child`/`combine`/`subApp`

There are no `child()`, `combine()`, or `subApp()` primitives in the
signal runtime. Decompose with view functions: a module exports a
`view(props, send)` function and an `update(slice, msg)` reducer; the
parent owns the slice, derives the child's props as signals, and routes
namespaced messages with a plain switch.

```ts
// toolbar.ts — props are SIGNALS derived from the parent state.
import type { Signal } from '@llui/dom'
export type ToolbarProps = { tools: Signal<Tool[]>; toolbar: Signal<ToolbarSlice> }
export function toolbarView(props: ToolbarProps, send: (msg: ToolbarMsg) => void): readonly Node[] {
  /* … build from props.tools.map(...), props.toolbar.at('menuOpen'), … */
}
export function toolbarUpdate(slice: ToolbarSlice, msg: ToolbarMsg): ToolbarSlice {
  /* … */
}

// parent.ts
view: ({ state, send }) => [
  toolbarView({ tools: state.map((s) => s.tools), toolbar: state.at('toolbar') }, (msg) =>
    send({ type: 'toolbar', msg }),
  ),
]
// parent update routes:
//   case 'toolbar': return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]
```

Cross-cutting concerns (toasts, modals) live as slices on the root
state. For values that must reach deep into the tree without
prop-threading, use context: `createContext` / `provide` / `useContext`.
For genuinely independent imperative code, use `foreign()` (see
08 Ecosystem Integration §2).

## #8 — SSR + hydration

| Legacy                                  | Signal                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| `__renderToString(state)`               | `renderToString(def, state, env)` (or `renderNodes`/`serializeNodes`) |
| `data-llui-hydrate` markers in the HTML | none — hydration rebuilds the tree                                    |
| `hydrateApp` walks markers and attaches | `hydrateSignalApp(target, def, serverState)` — rebuild + atomic swap  |

`renderToString`/`renderNodes` take a server `DomEnv` from
`@llui/dom/ssr/jsdom` (`jsdomEnv()`) or `@llui/dom/ssr/linkedom`. Server
render is pure — effects (including `onMount`/`portal`) are not
dispatched. `hydrateSignalApp` builds the client tree against
`serverState` (matching the SSR render) and atomically replaces the
server HTML, so there is no flash; `init()`'s effects are skipped by
default (pass `runInitEffects: true` for an `init()` gated to no-op on
the server).

For `@llui/vike`, the adapter wires this via `createOnRenderHtml`
(`{ domEnv, Layout?, document }`) and `createOnRenderClient`. Because
the signal `init()` takes no data, each layer's route `data` is supplied
as that layer's seed state. Persistent layouts place `pageSlot()` (from
`@llui/vike/client`) where the nested page renders — name the file
`Layout.ts`, not `+Layout.ts`.

## Mechanical sweep checklist

1. **Convert each component's `view`** to `({ state, send }) => [...]`
   and add element/structural imports from `@llui/dom`.
2. **Rewrite closure reads** `s => expr` as `state.map(...)` /
   `state.at('path')`; move imperative reads in handlers to `.peek()`.
3. **Convert `each`/`show`/`branch`** to the positional signal forms
   (#2, #3). Rows become `Signal<T>`; use `item.at('field')`.
4. **Drop the data arg from `init()`**; route external data through the
   adapter's seed-state path.
5. **Bridge `onEffect`** to `(effect, api)` and forward into
   `handleEffects().else(...)` with a lifecycle `AbortController`.
6. **Delete every hand-authored `__dirty`** and any `flush()` calls
   that only forced a pending update.
7. **Replace `child`/`combine`/`subApp`** with view functions +
   plain-switch routing (#7).
8. **Update SSR/hydration** to `renderToString`/`renderNodes` +
   `hydrateSignalApp` (#8); remove any `data-llui-hydrate` assumptions.
9. **Fix lint failures** surfaced as compile errors by the signal lint
   rules (#6).

For the canonical signal authoring shape, see the examples
(`examples/counter`, `examples/todomvc`, `examples/vike-layout`),
`packages/components/src/components/dialog.ts`, and the type signatures
in 09 API Reference.md.
