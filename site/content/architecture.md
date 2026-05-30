---
title: Architecture
description: 'How LLui works: build-once views, chunked-mask reactivity, compiler, scope tree.'
---

# Architecture

How LLui works under the hood.

## Overview

LLui is a compile-time-optimized web framework built around The Elm Architecture (TEA). The core loop is identical to Elm's: state is immutable, the only way to change it is to dispatch a `Msg`, `update()` folds the message over the current state and returns a new state plus a list of effects, and the runtime executes those effects outside the pure function boundary.

The critical departure from Elm -- and from virtually every other TEA-inspired framework -- is what happens when state changes arrive at the DOM. Traditional approaches re-run a virtual DOM diffing pass over the entire tree. LLui has no virtual DOM. **`view()` is a one-shot imperative call that runs exactly once at mount time**, building real DOM nodes and recording _where_ state is consumed. After mount, state changes skip `view()` entirely.

Reactivity is expressed through **signals**. The view bag carries `state`, a `Signal<State>` handle. You slice into it with `.at('field')` to get a sub-path signal, derive with `.map(fn)`, and read a one-shot snapshot with `.peek()`. Every signal passed to an element helper or `text()` becomes a _binding_: an accessor paired with the dependency paths it reads and a commit that writes one DOM node. A static value is plain; an event handler is a plain function. `.peek()` is for event handlers and effects — never as a slot value, because a peek reads once and never updates.

```ts
// The complete shape of a component. No surprises.
import { component, mountApp, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'increment' }

export const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'increment':
        return [{ count: state.count + 1 }, []]
    }
  },
  view: ({ state, send }) => [
    div([
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ]),
  ],
})
```

The view bag is `{ state, send }` — `state: Signal<State>`, `send: (msg: M) => void`.
Element and structural helpers (`div`, `button`, `text`, `each`, `show`, `branch`, …) are
module imports from `@llui/dom`, not bag fields. There is a single import surface:
`@llui/dom` — no `/signals` subpath, no separate legacy runtime, and no `@llui/eslint-plugin`.

## The Update Cycle

When state changes, the runtime drives a single mask-gated sweep over the flat binding array. There is no virtual DOM and no tree traversal.

1. **Compute the dirty set.** From old→new state, reference-equality at each tracked path yields a dirty chunk-set. Because TEA reducers return immutable, structurally-shared state, an unchanged field is reference-identical and dirties nothing; an unchanged subtree short-circuits all its leaves with one `Object.is`. If nothing a scope reads changed, its whole sweep is skipped.
2. **Gate by mask.** Each binding carries a sparse mask of the dependency-path chunks it reads. A binding whose mask doesn't intersect the dirty set is skipped without calling its accessor — no `produce` invocation, no DOM access.
3. **Output equality.** A binding that passes the gate runs its accessor; the commit fires only if the value actually changed (`Object.is` against the last value). A coarse dependency wastes an accessor call but never a DOM write.

Structural primitives — `show`, `branch`, `each` — are not plain bindings. Each registers a structural binding gated on its own deps, but its commit _reconciles_ (swaps an arm, diffs keyed rows) and owns child scopes. Both kinds live in the same sweep; structural reconciles and binding commits happen as their deps dirty. `foreign()` creates an opaque container for third-party imperative components (ProseMirror, Monaco, etc.) — LLui owns the container but not its contents; declared `state` signals materialize to `LiveSignal`s that the imperative `mount` callback binds.

On a typical update where a few fields in a 50-binding component change, the sweep does ~48 mask checks, a couple of accessor calls, a couple of value comparisons, and a couple of DOM writes.

## Chunked-Mask Reactivity

The compiler extracts the dependency paths each signal reads, and the runtime packs every unique path into a bit across N 32-bit **chunks** (a `PathTable`). Each binding's mask is a sparse list of only the chunks it touches.

### Path tracking

An accessor reading `s.user.name` gets a different bit from one reading `s.user.email`, so changing the user's name does not trigger re-evaluation of email bindings. A signal reading a parent path (`s.user` as a whole object) depends on any sub-field change, because reference-equality at `user` dirties when any child changes.

```
user.name   -> bit in chunk 0
user.email  -> bit in chunk 0
user.avatar -> bit in chunk 0
filter      -> bit in chunk 0
todos       -> bit in chunk 0

// state.at('user') depends on the whole user subtree.
// state.at('user').at('name') depends on exactly that leaf.
```

### No path ceiling

There is **no fixed path budget.** A 200-path component uses 7 chunks, and each binding's gate is still a handful of integer ANDs over the chunks its mask touches — ~constant regardless of total path count. (This replaces the older fixed two-word `mask`/`maskHi` design and its 62-path limit, which was deleted along with the legacy runtime.) Update cost scales with what changed, not with state depth, so a large flat state is fine — reach for view functions (sliced signals) before a `child()` boundary.

### Per-array handling

For arrays, the dirty computation stops at the array reference itself: changing one row produces a new array reference and dirties the `each`. Per-row granularity comes from per-row scopes — each row is mounted on a combined `{ item, state, index }` context, so a shared-state change fans out only to the row bindings that read it, an item change hits only that row, and kept rows are mutated in place rather than recreated.

## Scope Tree

The scope tree is the ownership graph. Every binding, every event listener, every `onMount` callback, every portal, every `foreign` instance, and every mounted `show`/`branch` arm or `each` row is owned by a `SignalScope`. When a `show` flips, a `branch` swaps arms, or an `each` row drops, disposing the scope walks the subtree and fires all teardowns — depth-first, children before parent.

```typescript
type SignalScope = {
  parent: SignalScope | null
  children: SignalScope[]
  teardowns: Array<() => void>
  bindings: Binding[]
}

function disposeScope(scope: SignalScope) {
  // depth-first: children before parent
  for (const child of scope.children) {
    disposeScope(child)
  }
  for (const teardown of scope.teardowns) {
    teardown()
  }
  for (const binding of scope.bindings) {
    removeFromFlatArray(binding)
  }
  scope.parent?.children.splice(scope.parent.children.indexOf(scope), 1)
}
```

The teardown list holds anything with an external side effect: `removeEventListener` callbacks, `onMount` cleanup callbacks returned from the mount callback, `foreign` unmount calls, subscription disposers, and portal node removal functions. Each is registered against the owning scope at creation time. When a `show` arm leaves, its teardowns fire _before_ its nodes are removed.

### Depth-first disposal

Depth-first disposal is required for correctness when child scopes hold references to resources that parent scope cleanup expects to be live. The scope hierarchy mirrors the conceptual nesting of the view: a branch scope is a child of the scope that owns the branch block; each entry scopes are children of the each scope. `disposeScope(branchScope)` recursively cleans up everything the active case ever created, regardless of how deeply nested.

### Why scopes, not component lifecycle

Component-level lifecycle (mounted/unmounted) is not granular enough: a single component may contain multiple branch blocks, each with independent lifetimes. Scopes capture the structural lifecycle of each subtree independently. The consequence is that "forgot to unsubscribe" is structurally impossible -- there is no API that creates a subscription without also requiring a scope. The scope is the subscription's lifetime.

### The flat binding array

A tree traversal of the scope hierarchy on every update would be O(scope count). The runtime instead iterates a flat binding array and gates by mask, making the sweep proportional to the bindings whose mask intersects the dirty set -- often a small constant regardless of component size.

### Cross-instance scope parenting

`mountSignalComponent` accepts an `{ anchor }` target (a comment node) so a mounted instance's root scope becomes a child of an existing scope in a different component instance. This is what `@llui/vike`'s persistent-layout feature uses: when a layout calls `pageSlot()`, the page mounts at the slot's anchor, and the page's root scope lives inside the layout's scope tree. The page is its own component instance with its own `update` loop, state, and `send` — but its root scope is parented inside the layout's.

Two consequences follow from that one parameter:

**Context flow across layers.** `useContext` walks up from the current render scope through the chain of `parent` pointers until it finds a provider. With the page's `rootScope` parented inside the layout, a `useContext(ToastContext)` call inside the page walks `pageRootScope → slotScope → layoutProviderScope → layoutRootScope` and finds any provider the layout installed above the slot. This is how layout-owned dispatchers (toast queues, progress bars, breadcrumbs) reach pages without direct messaging.

**Disposal cascades in the right direction.** Disposing the layout's root cascades through `slotScope` → page `rootScope` → page's entire subtree — the whole chain tears down in one pass. Disposing only the page's root disposes its subtree without touching the layout: child scopes disposed, disposers fired, bindings marked dead, but the `parent` pointer from `slotScope` downward is the only upward reference and it's never followed by `disposeScope`. Navigating between pages (page re-mount, layout persists) is exactly this asymmetric disposal.

For framework-adapter packages that need to build primitives like `pageSlot()` on top of the runtime, the low-level glue (`getRenderContext`, `createScope`, `addDisposer`) is exposed via the `@llui/dom/internal` subpath. App authors never reach for this — it's for sibling packages in the workspace that compose at the render-context layer.

## Compiler Pipeline

The Vite plugin runs the compiler over each source file using the **TypeScript Compiler API** exclusively, with `enforce: 'pre'` so it processes raw TypeScript before Vite strips types. Its job is to analyze each signal's dependency paths and, where possible, **lower** the inline view to allocation-free runtime calls.

### Dependency analysis

For each signal slot (`text(state.at('count').map(String))`, `div({ class: state.at('open').map(…) })`, structural deps), the compiler walks the signal expression to collect the dependency paths it reads. Those paths feed the runtime's `PathTable`, which assigns each unique path a bit and builds the per-binding sparse mask. Because the analysis is path-based, the common `state.at('a.b').map(fn)` shape is fully statically extractable.

### Lowering the inline view

When a component's `view` is the common inline shape, the compiler rewrites the authoring calls (`text`, `div`, `each`, …) to their runtime counterparts (`signalText`, `el`, `signalEach`, …). This erases the signal-handle allocation for the hot view path — the runtime builds the same mask-gated bindings directly from `(produce, deps)` tuples.

Views the compiler can't lower (helper functions, block bodies) run via the runtime _authoring_ helpers, which consume the same signal handles at runtime. Either way the runtime builds the same mask-gated bindings, so view-helper composition Just Works.

### Compile-time correctness rules

The framework's correctness, agent-protocol, and convention rules are non-bypassable compile-time **errors** surfaced by the Vite plugin (LLMs ignore warnings, so a build that fails closed is the only effective channel). The signal-specific rules catch the reactivity foot-guns: `peek-in-slot` (a `.peek()` used as a slot value), `operator-on-signal` (`signal + 1`, ternary on a signal), `pure-derive-body` and `no-node-construction-in-body` (side effects / DOM construction inside a `.map` body), and `whole-state-to-call` (passing the root `state` to a call in a slot).

## Synchronous `send`

`send(msg)` runs the pure reducer **immediately**. If the returned state differs by reference, it commits to the reconciler, notifies subscribers, then dispatches effects to `onEffect`. There is no microtask queue and no combined-dirty coalescing — each `send` is its own update cycle. Under synchronous TEA the mask-gated reconcile is cheap enough that batching isn't warranted.

```ts
send({ type: 'togglePanel' })
// DOM is already updated synchronously; safe to measure.
const rect = panelEl.getBoundingClientRect()
```

`handle.flush()` is retained as a **no-op** on the component handle, for parity with harnesses and agents that assume an async batch model. An effect that calls `send` again is an ordinary synchronous reducer step, not re-entrant reconciliation.

## Effects as Data

Effects are plain data objects. `update()` returns them; the runtime dispatches them after DOM updates have been applied. This means effects are serializable, loggable, and testable without mocking the DOM or the runtime -- you test `update()` in isolation.

### The effect handler chain

The core runtime hands every effect to the component's `onEffect(effect, { send, state })` after the DOM is updated. The `@llui/effects` package provides `handleEffects<Effect, Msg>()`, a composable chain that interprets the standard effect types (`http`, `cancel`, `debounce`, `timeout`, `interval`, `sequence`, `race`, …), tracks cancellation tokens and debounce timers in a per-component closure, and passes unrecognized effects to a `.else()` callback as one `{ effect, send, signal }` context.

TypeScript narrows the `.else()` callback to only the effect variants that `handleEffects` doesn't consume, and `noImplicitReturns` catches missing cases.

```ts
import { component, input, text } from '@llui/dom'
import { handleEffects, http, cancel, debounce } from '@llui/effects'

type Effect =
  | { type: 'http'; url: string; onSuccess: string; onError: string }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'debounce'; key: string; ms: number; inner: Effect }
  | { type: 'analytics'; event: string }

export const Search = component<State, Msg, Effect>({
  // ...
  update: (state, msg) => {
    switch (msg.type) {
      case 'setQuery':
        return [
          { ...state, query: msg.value, loading: true },
          [
            cancel(
              'search',
              debounce(
                'search',
                300,
                http({
                  url: `/api?q=${msg.value}`,
                  // onSuccess/onError are callbacks returning a Msg:
                  onSuccess: (data) => ({ type: 'results', payload: data }),
                  onError: (err) => ({ type: 'error', error: err.message }),
                }),
              ),
            ),
            { type: 'analytics', event: 'search_typed' },
          ],
        ]
      case 'clearSearch':
        return [{ ...state, query: '', results: [], loading: false }, [cancel('search')]]
    }
  },

  // handleEffects() consumes http/cancel/debounce.
  // .else() receives only the remaining types -- here, just 'analytics'.
  onEffect: handleEffects<Effect, Msg>().else(({ effect }) => {
    switch (effect.type) {
      case 'analytics':
        window.analytics?.track(effect.event)
        break
    }
  }),

  view: ({ state, send }) => [
    input({
      value: state.at('query'),
      onInput: (e) => send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
    }),
  ],
})
```

### Automatic cleanup

`handleEffects` receives an `AbortSignal` (the `signal` field of the `.else()` context) that aborts when the component's scope is disposed — it listens for `abort` to cancel in-flight HTTP requests, clear debounce timers, and discard pending sequence/race entries. Custom handlers use it for their own resources: `signal.addEventListener('abort', () => ws.close())`. An `onEffect` handler may also return a cleanup function, which the runtime registers for disposal.

### Effect dispatch ordering

Effects from a `send` are dispatched after the DOM update, in the order `update()` produced them. If an effect handler calls `send()` again, that is an ordinary synchronous reducer step — its own update cycle, not re-entrant reconciliation.
