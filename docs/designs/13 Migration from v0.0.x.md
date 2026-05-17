# Migration from v0.0.x to the unified composition model

This doc covers the breaking changes that landed on the
`explore/controlled-components` branch (merged 2026-05) and how to update
an existing app written against the two-tier `component()` / `child()`
model.

The branch deletes ~1,600 LOC of legacy primitives and replaces them
with a single composition model: view functions for decomposition,
`combine()` for reducer composition, and `subApp` as a lint-enforced
escape hatch for genuine state-lifetime isolation.

## At a glance — what was removed

| Removed                                | Replacement                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `child({ def, props, onMsg, ... })`    | A view function: a module exporting `update` + `view`    |
| `propsMsg`                             | Direct slice ownership; or `onLayerDataChange` for vike  |
| `receives` + addressed effects         | Shared parent state; or `AppHandle.send` from an adapter |
| `addressOf` / `setAddressedDispatcher` | Same as above                                            |
| User-authored `__dirty`                | Compiler-emitted `__prefixes` (throws if user-supplied)  |
| ESLint `unnecessary-child`             | (rule deleted — `child()` no longer exists)              |
| ESLint `child-static-props`            | (rule deleted)                                           |

| Added                              | Purpose                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `combine({ slice: reducer, ... })` | Compose slice reducers by `${slice}/${action}` prefix  |
| `subApp({ reason, def, ... })`     | Escape hatch — embed an isolated TEA loop              |
| ESLint `subapp-requires-reason`    | Enforces a non-empty rationale for every `subApp` call |

## #1 — `child()` → view function

The largest change. Every `child()` call site moves to a view function
that the parent invokes directly, with the parent owning all state.

### Before

```ts
// dashboard.ts
type State = { /* dashboard-specific */ }
type Msg = { type: 'click' } | { type: 'toolbarMsg'; msg: ToolbarMsg }

export const Dashboard = component<State, Msg>({
  name: 'Dashboard',
  init: () => [{ ... }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'click': return [{ ...state, clicked: true }, []]
      // Note: 'toolbarMsg' isn't actually handled here — child() owns
      // the toolbar's state machine and routes messages internally
    }
  },
  view: ({ send }) =>
    div({}, [
      child({
        def: Toolbar,
        key: 'toolbar',
        props: (s) => ({ tools: s.tools }),
        onMsg: (msg) =>
          msg.type === 'toolSelected'
            ? { type: 'toolSelected', id: msg.id }
            : null,
      }),
    ]),
})

// toolbar.ts — its own ComponentDef with its own state, propsMsg, etc.
export const Toolbar = component<ToolbarState, ToolbarMsg, never, ToolbarProps>({
  name: 'Toolbar',
  init: (props) => [{ tools: props.tools, menuOpen: false }, []],
  propsMsg: (props) => ({ type: 'propsChanged', props }),
  update: (state, msg) => { /* ... */ },
  view: ({ send }) => [/* ... */],
})
```

### After

```ts
// toolbar.ts — exports update + view functions, NOT a component
export type ToolbarSlice = { menuOpen: boolean }
export type ToolbarMsg = { type: 'toggleMenu' } | { type: 'selectTool'; id: string }
export type ToolbarProps<S> = {
  tools: (s: S) => Tool[]
  toolbar: (s: S) => ToolbarSlice
}

export function toolbarUpdate(slice: ToolbarSlice, msg: ToolbarMsg): ToolbarSlice {
  switch (msg.type) {
    case 'toggleMenu':
      return { ...slice, menuOpen: !slice.menuOpen }
    case 'selectTool':
      return { ...slice, menuOpen: false }
  }
}

export function toolbarView<S>(props: ToolbarProps<S>, send: (msg: ToolbarMsg) => void) {
  return div({}, [
    button({ onClick: () => send({ type: 'toggleMenu' }) }, [text('Tools')]),
    show({
      when: (s) => props.toolbar(s).menuOpen,
      render: () =>
        each({
          items: props.tools,
          key: (t) => t.id,
          render: ({ item }) =>
            button({ onClick: () => send({ type: 'selectTool', id: item.id() }) }, [
              text(item.name),
            ]),
        }),
    }),
  ])
}

// dashboard.ts — parent owns the toolbar slice
type State = {
  toolbar: ToolbarSlice
  tools: Tool[]
  /* ... */
}

type Msg = { type: 'toolbar'; msg: ToolbarMsg } | { type: 'click' }

export const Dashboard = component<State, Msg>({
  name: 'Dashboard',
  init: () => [{ toolbar: { menuOpen: false }, tools: [] /* ... */ }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'toolbar':
        return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]
      case 'click':
        return [{ ...state, clicked: true }, []]
    }
  },
  view: ({ send }) =>
    div({}, [
      toolbarView<State>({ tools: (s) => s.tools, toolbar: (s) => s.toolbar }, (msg) =>
        send({ type: 'toolbar', msg }),
      ),
    ]),
})
```

**What changes:**

- The child module exports a `(props, send)` view function and an
  `update(slice, msg)` reducer instead of a `ComponentDef`. The parent
  imports both.
- The parent's `Msg` union namespaces the child's messages:
  `{ type: 'toolbar'; msg: ToolbarMsg }`. The parent's reducer routes
  by `msg.type === 'toolbar'` to the child reducer.
- The parent's state owns the child's slice directly — no `props`
  diffing, no `propsMsg` cascade. Path-keyed reactivity (compiler-
  emitted `__prefixes`) tracks `s.toolbar.menuOpen` precisely.
- No `child()` call in the view. Just invoke `toolbarView(props, send)`
  inline.

**When you have many slices**: replace the parent's `update()` with
`combine()` (see #4 below).

## #2 — `propsMsg` → opt-in callback (vike) or direct slice ownership

`propsMsg` was the mechanism `child()` used to translate parent
property changes into messages for the embedded child's update loop.
The unified model has no `child()` boundary, so `propsMsg` has nothing
to translate.

The one production consumer was `@llui/vike`'s persistent-layout chain,
which now exposes `onLayerDataChange` on `RenderClientOptions`:

```ts
// Before — Layout component declared propsMsg
const NavAwareLayout: ComponentDef<LayoutState, LayoutMsg, never, NavData> = {
  // ...
  propsMsg: (props) => ({ type: 'navChanged', data: props as NavData }),
  // ...
}

// After — vike adapter dispatches imperatively
createOnRenderClient({
  Layout: NavAwareLayout,
  onLayerDataChange: ({ def, handle, newData }) => {
    if (def === NavAwareLayout) {
      handle.send({ type: 'navChanged', data: newData as NavData })
    }
  },
})
```

The user discriminates on `def` (or `def.name`) and dispatches through
the framework-supplied `AppHandle`. No special framework support
needed; no implicit prop-diffing.

For non-vike `propsMsg` consumers: any pattern that pushed data INTO
the child becomes either (a) direct slice ownership by a parent, or
(b) an `AppHandle.send` from whoever holds the handle externally.

## #3 — `receives` + addressed effects → shared parent state

Addressed effects (`toToastManager.show({ message: '...' })`) used a
runtime registry keyed by component name. Each target component
declared a `receives` map of typed handlers; the sender imported the
target's `address` builder.

The unified model handles cross-cutting concerns through shared parent
state:

```ts
// Before — toast manager was its own component
const ToastManager = component<ToastState, ToastMsg, ToastEffect>({
  name: 'toast-manager',
  receives: {
    show: (params: { message: string }) => ({ type: 'add', message: params.message }),
  },
  // ...
})

// Some unrelated component dispatched:
return [state, [toToastManager.show({ message: 'Saved!' })]]

// After — toasts are a slice on the root state
type AppState = {
  toasts: Toast[]
  /* ... */
}

type AppMsg =
  | { type: 'toasts/add'; payload: string }
  | { type: 'toasts/dismiss'; id: string }
  | /* other app messages */

const update = combine<AppState, AppMsg, AppEffect>({
  toasts: (slice: Toast[], msg) => {
    switch (msg.type) {
      case 'add':
        return [[...slice, { id: nextId(), message: msg.payload }], []]
      case 'dismiss':
        return [slice.filter((t) => t.id !== msg.id), []]
    }
  },
})

// Anywhere in the view that wants to dispatch:
button({ onClick: () => send({ type: 'toasts/add', payload: 'Saved!' }) })
```

For coordination across genuinely independent apps (where shared state
isn't an option), use `AppHandle.send` from an adapter layer that
holds both handles. The framework no longer has a global dispatcher.

## #4 — `mergeHandlers` + `sliceHandler` → `combine()`

`mergeHandlers(handlerA, handlerB, ...)` and `sliceHandler({ narrow })`
are still exported (no behavior change). They predate `combine()` and
work fine for hand-routing.

`combine()` is the preferred new shape for parent reducers that are
mostly "route by message-type prefix":

```ts
// Before — manual switch
const update = (state: State, msg: Msg): [State, Effect[]] => {
  switch (msg.type) {
    case 'counters/increment':
      return [{ ...state, counters: countersUpdate(state.counters, { type: 'increment' }) }, []]
    case 'counters/decrement':
      return [{ ...state, counters: countersUpdate(state.counters, { type: 'decrement' }) }, []]
    case 'ui/toggleSidebar':
      return [{ ...state, ui: uiUpdate(state.ui, { type: 'toggleSidebar' }) }, []]
    /* etc. */
  }
}

// After — combine routes by slice prefix
import { combine } from '@llui/dom'

const update = combine<State, Msg, Effect>({
  counters: countersUpdate, // gets msg.type === 'increment' / 'decrement' (stripped of `counters/` prefix)
  ui: uiUpdate,
})
```

Messages must be dispatched as `{ type: '${slice}/${action}', ... }`.
`combine()` rewrites `msg.type` to the un-prefixed form before calling
the slice reducer.

If the parent also handles top-level (non-prefixed) messages, pass a
second argument:

```ts
const update = combine<State, Msg, Effect>(
  { counters: countersUpdate, ui: uiUpdate },
  (state, msg) => {
    switch (msg.type) {
      case 'shutdown':
        return [{ ...state, alive: false }, []]
    }
    return [state, []]
  },
)
```

## #5 — User-authored `__dirty` → error

The compiler used to emit a `__dirty(o, n)` function that compared each
top-level state field via `Object.is`, returning a bitmask of changed
field bits. Some apps hand-authored their own `__dirty` for hot-path
optimization.

The compiler now emits `__prefixes` (path-keyed reactivity) instead —
per-prefix accessors that the runtime reference-compares. This is
strictly more precise (one bit per _prefix_, not per _top-level field_)
and supports 62 prefixes via two-word masks instead of the old 31-field
ceiling.

**User-supplied `__dirty` is rejected at mount.** The runtime throws:

```
[llui] Component "MyComponent" defines `__dirty` directly. This field
is no longer accepted — the compiler emits `__prefixes` (path-keyed
reactivity) automatically. Remove `__dirty` from the ComponentDef;
either the compiler will regenerate the correct prefix table, or
uncompiled components will fall back to FULL_MASK.
```

**Migration:** delete the `__dirty` field from the `ComponentDef`. If
the component is compiled with `@llui/vite-plugin`, the new
`__prefixes` emission replaces it automatically with finer-grained
gating. If the component is uncompiled (rare — most LLui apps run
through the Vite plugin), the runtime falls back to `FULL_MASK` and
every binding re-evaluates every cycle. Adding the plugin gives you
the precision back.

## #6 — `subApp` — the new escape hatch

For the small set of cases where `child()` was used to truly isolate
an independent TEA loop (third-party bundled apps, demo embeds inside
a host page, library components that ship their own complete app),
the replacement is `subApp`:

```ts
import { subApp } from '@llui/dom/escape-hatch'

// In a view function:
subApp({
  reason: 'third-party bundled widget owns its own state lifetime',
  def: SomeBundledApp,
  data: { theme: 'dark' }, // optional init data
  onHandle: (handle) => {
    // Optional: capture the handle for imperative send/getState later
  },
})
```

The `reason` field is required and **must be a non-empty string** —
the `llui/subapp-requires-reason` ESLint rule rejects empty or
placeholder reasons. The string is surfaced in the rendered DOM as
`data-llui-sub-app-reason` so reviewers can see the rationale during
code review.

**Do not use `subApp` to "isolate a complex component" or "encapsulate
state."** The unified composition model has path-keyed reactivity that
scales precisely with the number of prefixes read — depth of nesting
doesn't tax the dirty walker. If you reach for `subApp`, the lint rule
will demand a reason; if the reason is "complexity" or "encapsulation,"
you don't need `subApp` — extract a view function instead.

## Mechanical sweep checklist

For an app like `dicerun2` with 62 `child()` call sites, here's the
order of operations that minimizes broken-intermediate states:

1. **Define slice types and reducers in the child modules.** Export a
   `Slice` type, a `Msg` union, an `update(slice, msg)` reducer, and a
   `view(props, send)` function. Don't delete the old `ComponentDef`
   yet.
2. **In the parent, add the child's slice to State and namespace its
   messages in Msg.** State grows; the parent's reducer learns to
   route the new prefix.
3. **Replace the `child()` call with the view function invocation.**
   `child({ def: X, ... })` becomes `xView(props, msg => send({ type: 'x', msg }))`.
4. **Verify the migration site by site.** Each `child()` replacement
   is independent; commit them in small batches.
5. **Once all `child()` sites are gone**, delete the old `ComponentDef`
   exports from each child module. The `(props, send)` view function
   is the only surface left.
6. **Replace any hand-routing in the parent reducer with `combine()`**
   when the switch becomes "case 'x': xUpdate; case 'y': yUpdate; ..."
   shaped.
7. **Sweep for any remaining `propsMsg`, `receives`, `addressOf`,
   `__dirty` references.** Each becomes an error under the new types.

## Help and notes

- The runtime throw on user-supplied `__dirty` is intentional — it's a
  loud failure rather than a silent degradation.
- If the `bitmask-overflow` lint rule fires on a component that
  previously fit, your migration probably split a single top-level
  field into many path-keyed prefixes. The new 62-prefix ceiling
  accommodates almost all real shapes; if you genuinely exceed 62,
  restructure to nest the over-broad fields under a smaller number of
  reference-stable parents.
- View functions inherit the parent's `View<S, M>` bag through the
  `send` callback's type — there's no `View<S, M>` generic to thread
  through.
- The compiler skips emit on files without a `component(...)` call.
  Pure view-function modules don't need it; they're walked by the
  parent's compile pass which inlines accessor analysis through
  delegated calls.

For the historical rationale behind these changes:

- `docs/proposals/unified-composition-model.md` — original design
- `docs/proposals/unified-composition-model-spike-result.md` — benchmark validation
- `docs/proposals/unified-composition-model-status.md` — branch status with all four items resolved
- `docs/designs/01 Architecture.md` and `docs/designs/07 LLM Friendliness.md` — rewritten around the new model
