---
title: Architecture
description: "How LLui works: two-phase update, bitmask optimization, compiler, scope tree."
---

# Architecture

How LLui works under the hood.

## Overview

LLui is a compile-time-optimized web framework built around The Elm Architecture (TEA). The core loop is identical to Elm's: state is immutable, the only way to change it is to dispatch a `Msg`, `update()` folds the message over the current state and returns a new state plus a list of effects, and the runtime executes those effects outside the pure function boundary.

The critical departure from Elm -- and from virtually every other TEA-inspired framework -- is what happens when state changes arrive at the DOM. Traditional approaches re-run a virtual DOM diffing pass over the entire tree. LLui does not have a virtual DOM. **`view()` is a one-shot imperative call that runs exactly once at mount time**, building real DOM nodes and recording _where_ state is consumed. Every arrow function passed to an element helper or `text()` is a _binding_: an accessor `(state: S) => T` attached to a specific DOM node.

After mount, state changes skip `view()` entirely. The runtime instead drives two subsequent phases -- structural reconciliation and binding updates -- gated by a bitmask that the compiler injects at build time.

```ts
// The complete shape of a component. No surprises.
type State = { count: number }
type Msg = { type: 'increment' }

export const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'increment':
        return [{ count: state.count + 1 }, []]
    }
  },
  view: ({ send, text }) => {
    return div([
      text((s) => String(s.count)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ])
  },
})
```

## Two-Phase Update

Every update cycle runs in two strictly ordered phases. The ordering is not arbitrary; it is derived from the dependency relationship between structure and content.

### Phase 1 -- Structural Reconciliation

`branch`, `each`, and `show` are structural primitives. They own comment-node markers and lists of scopes. When the discriminant or item array changes, Phase 1 surgically removes old DOM subtrees (disposing their scopes), creates new ones by re-invoking the case or item builder functions, and splices them into the live DOM. Placeholder comment nodes act as stable anchors so insertion points survive arbitrary structural change.

Transitions hook in here via `enter`/`leave`/`onTransition` fields on the primitive's object parameter. `foreign()` creates an opaque container for third-party imperative components (ProseMirror, Monaco, etc.) -- LLui owns the container but not its contents; a typed `sync` bridge handles state propagation.

### Phase 2 -- Binding Updates

Every non-structural reactive value is a `Binding` record: `{ node, kind, accessor, lastValue, mask }`. Phase 2 iterates the flat binding array and, for each binding:

1. Checks `(binding.mask & dirtyMask) === 0` -- if true, skip immediately
2. Calls the accessor to get the new value
3. Compares to `binding.lastValue` with `Object.is` -- if equal, skip
4. Calls `applyBinding()` to write the DOM

Nothing else touches the DOM.

### Why this order matters

Phase 2 iterates the binding array as it exists _after_ Phase 1 finishes. If Phase 2 ran first, it would encounter bindings belonging to scopes that Phase 1 is about to destroy -- either wasting work on bindings about to be discarded or writing to DOM nodes that are simultaneously being removed. Running structural reconciliation first means the binding array in Phase 2 is always coherent: every entry belongs to a live scope, every DOM node it references is in the document.

```
function runUpdate(component, dirtyMask) {
  // Phase 1
  for (const structural of component.structuralBlocks) {
    structural.reconcile(dirtyMask)
  }

  // Phase 2
  for (const binding of component.bindings) {
    if ((binding.mask & dirtyMask) === 0) continue
    if (binding.perItem && binding.ownerScope.eachItemStable) continue
    const newValue = binding.accessor(state)
    if (Object.is(newValue, binding.lastValue)) continue
    binding.lastValue = newValue
    applyBinding(binding, newValue)
  }
}
```

On a typical update where a few fields in a 50-binding component change, Phase 2 does ~48 mask checks, 2 accessor calls, 2 value comparisons, and 2 DOM writes. There is no tree traversal, no snapshot, no diffing.

## Bitmask System

The `dirty` bitmask is injected by the Vite plugin at compile time. The plugin's TypeScript transform scans every reactive accessor in the file, extracts the **access paths** each accessor reads from the state parameter, assigns each unique path a bit position, and synthesizes a `__dirty(oldState, newState): number` function that ORs together bits for paths whose values changed.

### Path tracking

Access paths are tracked up to depth 2. An accessor reading `s.user.name` gets a different bit from one reading `s.user.email`, so changing the user's name does not trigger re-evaluation of email bindings. An accessor reading a parent path (`s.user` as a whole object) gets the **union** of all child path bits, correctly marking it as dependent on any sub-field change.

```
user.name   -> bit 0  (0x0001)
user.email  -> bit 1  (0x0002)
user.avatar -> bit 2  (0x0004)
filter      -> bit 3  (0x0008)
todos       -> bit 4  (0x0010)

// An accessor reading s.user gets bits 0|1|2 = 0x0007
// An accessor reading s.user.name and s.filter gets 0x0001 | 0x0008 = 0x0009
```

### The 31-bit limit

The compiler uses a **single-word mask** with graceful overflow:

- **<=31 paths**: each path gets its own bit (positions 0-30). The Phase 2 check is a single bitwise AND -- the fastest path and the common case.
- **32+ paths (overflow)**: the first 31 paths still get individual bits; paths 32+ use `FULL_MASK` (-1), meaning their bindings always re-evaluate when anything dirties.

The compiler emits a warning naming the top-level state fields by path count, so the developer knows exactly where to extract a child component or slice handler:

```
Component at line 120 has 45 unique state access paths (14 past the 31-path limit).
Top-level fields by path count: form (18), user (12), ui (8), filter (7).
Extract the largest fields into child components or slice handlers.
```

The overflow path is cheap (~1 microsecond per update at 40-80 paths), but components at that scale usually benefit from decomposition on architectural grounds -- clearer effect lifecycle, easier testing, independent state.

### Per-array handling

For arrays, path tracking stops at the array field itself (`s.todos` is a single bit). Per-item granularity is handled by the `eachItemStable` mechanism in Phase 2 rather than by the bitmask: if an item's reference is the same object as before, all of its per-item bindings are skipped.

## Scope Tree

The scope tree is the ownership graph. Every binding, every event listener, every `onMount` callback, every portal, and every child component is registered under a `Scope`. When a branch swaps arms or an each entry is removed, `disposeScope` walks the subtree and fires all disposers.

```typescript
type Scope = {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  eachItemStable: boolean
}

function disposeScope(scope: Scope) {
  // depth-first: children before parent
  for (const child of scope.children) {
    disposeScope(child)
  }
  for (const disposer of scope.disposers) {
    disposer()
  }
  for (const binding of scope.bindings) {
    removeFromFlatArray(binding)
  }
  scope.parent?.children.splice(scope.parent.children.indexOf(scope), 1)
}
```

The disposers list holds anything with an external side effect: `removeEventListener` callbacks, `ResizeObserver` disconnect calls, child component teardown functions, `onMount` cleanup callbacks, and portal node removal functions. Each is registered by calling `scope.disposers.push(fn)` at creation time.

### Depth-first disposal

Depth-first disposal is required for correctness when child scopes hold references to resources that parent scope cleanup expects to be live. The scope hierarchy mirrors the conceptual nesting of the view: a branch scope is a child of the scope that owns the branch block; each entry scopes are children of the each scope. `disposeScope(branchScope)` recursively cleans up everything the active case ever created, regardless of how deeply nested.

### Why scopes, not component lifecycle

Component-level lifecycle (mounted/unmounted) is not granular enough: a single component may contain multiple branch blocks, each with independent lifetimes. Scopes capture the structural lifecycle of each subtree independently. The consequence is that "forgot to unsubscribe" is structurally impossible -- there is no API that creates a subscription without also requiring a scope. The scope is the subscription's lifetime.

### The flat binding array

A tree traversal of the scope hierarchy on every update would be O(scope count). The flat array, pre-filtered by mask, makes Phase 2 proportional to the number of bindings with matching mask bits -- which is often a small constant regardless of component size.

## Compiler Pipeline

The Vite plugin performs three logically distinct passes over each source file, using the **TypeScript Compiler API** exclusively. It runs with `enforce: 'pre'` so it processes raw TypeScript before Vite strips types.

### Pass 1: Static/Dynamic Prop Split

Every property in a literal props object is classified into one of three categories:

**Static** -- the value is not a function. Applied once at mount via inline DOM mutation (`elem.className = ...`, `elem.setAttribute(...)`) and then garbage-collected.

**Event handler** -- the key matches `/^on[A-Z]/`. Extracted as `[eventName, handler]` pairs, wired via `addEventListener` at mount with a disposer on the current scope.

**Reactive binding** -- the value is an arrow function. Emitted as a `[mask, kind, key, accessor]` tuple in the bindings array.

```typescript
// Input:
div({ class: 'foo', title: (s) => s.title, onClick: handler }, [...])

// Output:
elSplit(
  'div',
  (__e) => { __e.className = String('foo' ?? '') },
  [['click', handler]],
  [[1, 'attr', 'title', (s) => s.title]],
  [...]
)
```

The binding kind is determined by the property name:

| Key pattern | Kind | DOM mutation |
|---|---|---|
| `class` or `className` | `'class'` | `elem.className = value` |
| `style.X` | `'style'` | `elem.style.setProperty('X', value)` |
| `value`, `checked`, `disabled`, etc. | `'prop'` | `elem[key] = value` |
| anything else | `'attr'` | `elem.setAttribute(key, value)` |

Pass 1 bails out conservatively when it encounters spreads, computed keys, or variable references as the props argument -- those call sites fall through to the uncompiled element helper path, which is functionally correct but unoptimized.

### Pass 2: Dependency Analysis and Mask Injection

Pass 2 computes the bitmask for every reactive accessor:

1. **Pre-scan** -- traverse the entire file to collect all unique state access paths. Nested chains up to depth 2 are tracked (`s.user.name` is distinct from `s.user.email`).
2. **Assign bits** -- each unique path gets a power-of-two bit position, in order of first encounter.
3. **Per-accessor masks** -- for each reactive accessor, re-traverse its body to collect the specific paths it reads, then OR their bits together.
4. **Synthesize `__dirty`** -- generate a function that compares old and new state and returns the OR of all changed path bits.

The compiler recognizes four patterns for path extraction: direct property access (`s.field`), destructuring (`const { field } = s`), single-assignment aliases (`const f = s.field`), and element access with string literals (`s['field']`). Patterns it cannot resolve (computed keys, multi-hop aliases, closure-captured variables) trigger a conservative `FULL_MASK` bail-out with a diagnostic warning identifying the exact accessor and a suggested rewrite.

### Pass 3: Import Cleanup

After Passes 1 and 2 rewrite element helper calls to `elSplit()`, the original element helper imports (`div`, `span`, `button`, etc.) may become unused. Pass 3 removes them, allowing the bundler to tree-shake `elements.ts` entirely.

## Message Queue and Batching

`send(msg)` does not execute an update cycle immediately. It enqueues the message and schedules a microtask if one is not already pending. When the microtask fires, `processMessages` drains the queue: it folds every pending message through `update()` in order, OR-merges their individual dirty masks into a single combined mask, then runs Phase 1 and Phase 2 exactly once with that combined mask.

```ts
// Three sends, one update cycle, one DOM write.
send({ type: 'setX', value: 10 })
send({ type: 'setY', value: 20 })
send({ type: 'setLabel', value: 'moved' })
// DOM unchanged here -- microtask hasn't fired yet.
// After the current synchronous JS completes, one update cycle runs.
```

Multiple rapid `send()` calls -- a WebSocket handler forwarding a burst of messages, or a drag event handler updating both position and hover target -- coalesce into one update cycle with one set of DOM writes. This is the primary batching mechanism: it eliminates redundant intermediate renders without developer opt-in.

`flush()` forces the pending update cycle to execute synchronously, right now. It exists for two cases: imperative code that must read DOM state immediately after a state change, and test harnesses that need deterministic step-by-step assertions.

```ts
send({ type: 'togglePanel' })
flush()
// DOM is now updated; safe to measure.
const rect = panelEl.getBoundingClientRect()
```

## Effects as Data

Effects are plain data objects. `update()` returns them; the runtime dispatches them after DOM updates have been applied. This means effects are serializable, loggable, and testable without mocking the DOM or the runtime -- you test `update()` in isolation.

### Built-in effects

The core runtime handles two effect types directly:

- `delay` -- setTimeout + message delivery
- `log` -- structured console output

### The effect handler chain

All other effects -- HTTP, cancellation, debounce, sequencing, racing -- are consumed by the component's `onEffect` handler. The `@llui/effects` package provides `handleEffects<Effect>()`, a composable chain that interprets standard effect types, tracks cancellation tokens and debounce timers in a per-component closure, and passes unrecognized effects through to a `.else()` callback.

TypeScript narrows the `.else()` callback to only the effect variants that `handleEffects` doesn't consume, and `noImplicitReturns` catches missing cases.

```ts
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
            cancel('search',
              debounce('search', 300,
                http({
                  url: `/api?q=${msg.value}`,
                  onSuccess: (data) => ({ type: 'results', payload: data }),
                  onError: (err) => ({ type: 'error', error: err }),
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
  onEffect: handleEffects<Effect>().else(({ effect }) => {
    switch (effect.type) {
      case 'analytics':
        window.analytics?.track(effect.event)
        break
    }
  }),
})
```

### Automatic cleanup

The runtime creates an `AbortController` when a component mounts and calls `controller.abort()` when the component's root scope is disposed. This signal is passed to every `onEffect` invocation. `handleEffects` listens for the `abort` event to cancel all in-flight HTTP requests, clear debounce timers, and discard pending sequence/race entries. Custom handlers use it for their own resources: `signal.addEventListener('abort', () => ws.close())`.

### Effect dispatch ordering

Effects are collected from all messages in a batch and dispatched after the DOM update, in the order they were produced. An effect from message 1 fires before an effect from message 3. If an effect handler calls `send()`, the new message is enqueued for the next microtask -- it does not re-enter `processMessages` synchronously (no re-entrancy).
