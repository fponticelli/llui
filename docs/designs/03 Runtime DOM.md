# Runtime DOM Update Strategy

This document describes how LLui translates state changes into DOM mutations. The design is intentionally minimal: no virtual DOM, no diff-then-patch, no framework-managed component lifecycle tree. Instead, LLui separates structural reconciliation from value propagation, operates on a flat binding array inside a tight loop, and delegates lifetime management entirely to the scope hierarchy.

---

## Two-Phase Update Model

Every update cycle runs in two strictly ordered phases. The ordering is not arbitrary; it is derived from the dependency relationship between structure and content.

**Phase 1 — Structural.** Evaluate every branch discriminant and every each item array. For each primitive whose key or array reference has changed, reconcile the DOM: dispose old scopes depth-first, remove old nodes from the document, create new scopes, execute new builder functions, insert new nodes. Placeholder comment nodes act as stable anchors so insertion points survive arbitrary structural change.

**Phase 2 — Bindings.** Iterate the flat binding array from start to finish. For each binding, check `(binding.mask & dirtyMask) === 0`; if true, skip immediately. If the binding belongs to an each entry and `ownerScope.eachItemStable` is true, skip. Otherwise call the accessor, compare to `binding.lastValue` with `Object.is`, and call `applyBinding()` only if the value changed.

The invariant that makes this ordering correct: Phase 2 iterates the binding array as it exists _after_ Phase 1 finishes. If Phase 2 ran first, it would encounter bindings belonging to scopes that Phase 1 is about to destroy — either wasting work on bindings about to be discarded or, worse, writing to DOM nodes that are simultaneously being removed. Running structural reconciliation first means the binding array in Phase 2 is always coherent: every entry belongs to a live scope, every DOM node it references is in the document.

The two phases also keep the hot path in Phase 2 branchless for the common case. The mask check is a single bitwise AND and a branch-predicted zero comparison. The `Object.is` check on the result of a cheap accessor is usually a pointer comparison. The actual DOM write (`textNode.nodeValue = ...`, `element.setAttribute(...)`) executes only when something genuinely changed. On a typical update where a few fields in a 50-binding component change, Phase 2 does 48 mask checks, 2 accessor calls, 2 value comparisons, and 2 DOM writes. There is no tree traversal, no snapshot, no diffing.

```
// Single-word bitmask. Paths 0–30 get individual bits; paths 32+ receive
// FULL_MASK (-1) on both __dirty output and per-binding masks, so the AND
// check below always fires for those bindings — graceful overflow using
// the same hot-path code.

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

The flat array is the critical structure. A tree walk of the scope hierarchy on every update would be O(scope count) regardless of how many bindings are dirty. The flat array, combined with the mask pre-filter, makes the inner loop proportional to the number of bindings whose state access paths could possibly have changed — which is usually a small fraction of the total.

---

## Message Queue and Batching

`send(msg)` does not trigger an update cycle immediately. It pushes the message onto a per-component queue and, if no microtask is already scheduled, calls `queueMicrotask(processMessages)`. When the microtask fires, `processMessages` drains the queue:

```typescript
function processMessages(component) {
  let state = component.state
  let combinedDirty = 0
  const allEffects: Effect[] = []

  while (component.queue.length > 0) {
    const msg = component.queue.shift()!
    // Note: update() is a pure function and must not throw. The framework
    // intentionally does not wrap update() in a per-message try/catch —
    // a throwing update() is a programmer error, not a recoverable condition.
    // If update() throws, the error propagates to the nearest errorBoundary.
    const [newState, effects] = component.update(state, msg)
    combinedDirty |= component.__dirty(state, newState)
    state = newState
    allEffects.push(...effects)
  }

  component.state = state

  if (combinedDirty !== 0) {
    runUpdate(component, combinedDirty)
  }

  for (const effect of allEffects) {
    dispatchEffect(component, effect)
  }
}
```

This design has three important properties:

1. **Coalescing.** Multiple `send()` calls within the same synchronous JS execution — e.g., a WebSocket handler forwarding a burst of messages, a drag handler updating position and hover state, or two event handlers firing on the same click — produce a single update cycle. The dirty mask is the OR of all individual deltas, so no path information is lost. The DOM receives one coherent set of writes.

2. **Order preservation.** Messages are processed in FIFO order. Each `update()` call sees the state produced by the previous one. The final state is identical to what sequential synchronous processing would produce — batching affects only when DOM writes happen, not what state they reflect.

3. **Effect ordering.** Effects are collected from all messages and dispatched after the DOM update, in the order they were produced. An effect from message 1 fires before an effect from message 3. This preserves causal ordering for effect chains.

### `flush()`

`flush()` executes the pending update cycle synchronously, immediately. If messages are queued, `flush()` drains them through `processMessages` and returns only after the DOM reflects all pending state changes. If no messages are pending, `flush()` is a no-op.

```typescript
function flush(component) {
  if (component.queue.length === 0) return
  // Cancel the scheduled microtask (it will no-op when it fires).
  component.microtaskScheduled = false
  processMessages(component)
}
```

`flush()` exists for two cases:

- **Imperative DOM measurement.** After `send({ type: 'showPanel' })`, the panel is not yet in the DOM. Calling `flush()` forces the structural reconciliation and binding updates to run, making the panel measurable: `flush(); const rect = panel.getBoundingClientRect()`.

- **Test harnesses.** Tests that need step-by-step mutation assertions call `flush()` after each `send()` to force deterministic, synchronous execution. Without `flush()`, tests must `await Promise.resolve()` to let the microtask fire — `flush()` is the synchronous equivalent.

`flush()` does not change the batching model. It simply advances the scheduled microtask to "now." Code that calls `send(); send(); flush()` still produces one update cycle — the two messages are still batched. `flush()` is the synchronous trigger, not a per-message trigger.

### Effect Dispatch

`dispatchEffect(component, effect)` is the bridge between the pure update loop and the outside world. The dispatch chain has two levels:

```typescript
function dispatchEffect(component, effect) {
  // 1. Built-in effects handled by the core runtime.
  if (effect.type === 'delay') {
    setTimeout(() => component.send(effect.onDone), effect.ms)
    return
  }
  if (effect.type === 'log') {
    console.log(effect.message)
    return
  }

  // 2. Addressed effects routed to the target component.
  if (effect.__addressed) {
    const target = componentRegistry.get(effect.__targetKey)
    if (target) target.send(effect.__msg)
    return
  }

  // 3. Component's onEffect handler — the developer's code.
  if (component.def.onEffect) {
    component.def.onEffect(effect, component.send, component.signal)
  }
}
```

The third argument to `onEffect` is an `AbortSignal` tied to the component's lifetime. The runtime creates an `AbortController` when the component mounts and calls `controller.abort()` when the component's root scope is disposed. This signal is passed to every `onEffect` invocation. Effect handlers use it for cleanup:

- `handleEffects()` (from `@llui/effects`) listens for the `abort` event to cancel all in-flight HTTP requests, clear debounce timers, and discard pending sequence/race entries.
- Custom handlers use it for their own resources: `signal.addEventListener('abort', () => ws.close())`.

The `onEffect` handler is called synchronously within `processMessages`, after all DOM updates for the current batch. Effects from message N are dispatched before effects from message N+1, preserving causal order. If an effect handler calls `send()`, the new message is enqueued for the next microtask — it does not re-enter `processMessages` synchronously (no re-entrancy).

---

## The Binding System

A binding is the fundamental unit that connects reactive state access paths to a DOM node property. It carries:

- `mask`: a bitmask indicating which state access paths this binding reads. Paths 0–30 each get one bit; paths 32+ receive `FULL_MASK` (-1) so their bindings always re-evaluate (graceful overflow).
- `accessor`: a function `(state) => value` that reads those paths
- `lastValue`: the value from the previous update cycle
- `kind`: one of `text`, `prop`, `attr`, `class`, `style`
- `node`: the target DOM node
- `key`: for `prop`, `attr`, and `style` kinds — the property or attribute name
- `ownerScope`: the scope that owns this binding's lifetime
- `perItem`: true if the binding was created inside an `each()` render callback via the scoped accessor pattern (e.g., `item(t => t.text)`). The runtime detects this by checking `accessor.length === 0` — scoped accessors produce zero-argument closures `() => selector(currentItemRef)`, whereas component-level state accessors have the signature `(state) => value` with `length === 1`. This distinction is reliable because bindings are only created through framework APIs (`text()`, `prop()`, etc.) which always pass state accessors with exactly one parameter

### Kinds and `applyBinding()`

Each kind maps to a specific DOM write strategy chosen for correctness and minimal overhead:

```
function applyBinding(binding, value) {
  switch (binding.kind) {
    case 'text':
      binding.node.nodeValue = String(value)
      break
    case 'prop':
      binding.node[binding.key] = value
      break
    case 'attr':
      if (value == null || value === false) {
        binding.node.removeAttribute(binding.key)
      } else {
        binding.node.setAttribute(binding.key, String(value))
      }
      break
    case 'class':
      binding.node.className = value
      break
    case 'style':
      if (value == null) {
        binding.node.style.removeProperty(binding.key)
      } else {
        binding.node.style.setProperty(binding.key, value)
      }
      break
  }
}
```

`prop` is used for `value`, `checked`, `selected`, `disabled`, and any other IDL attribute that the browser exposes as a JavaScript property. Direct property assignment is faster than `setAttribute` for these because it bypasses attribute serialization and directly updates the live value that the layout engine reads. `attr` is reserved for non-IDL attributes — `aria-*`, `data-*`, `role`, `href`, etc. — where the attribute string is what matters. `class` gets its own kind because `className` assignment is marginally faster than `setAttribute('class', ...)` and className is mutated frequently in reactive UIs.

### Lifecycle

Bindings are created during `view()` execution. The builder functions call `text(accessor)`, `prop(key, accessor)`, and so on, which allocate binding objects and register them in two places: the ownerScope's local list and the component's flat binding array. The flat array registration happens once at creation time, not on every update.

During Phase 2, the binding is evaluated. No subscription is created; no event is fired. The binding is pulled, not pushed.

Disposal happens when the ownerScope is disposed. The scope's disposer iterates its local binding list and splices each binding out of the flat component array by id. Splicing is O(n) in the number of bindings registered after this one, but disposal is rare (scope destroyed means branch switched or each entry removed) and n is typically small. After the splice, the binding object becomes unreachable and is collected by the GC.

No individual binding disposer is needed because bindings have no side effects beyond their DOM write. They do not hold event listeners, they do not subscribe to observables, they do not touch any external system. The only cleanup required is removing them from the iteration set, which the scope disposer handles.

### The `perItem` Optimization

The `each()` render callback receives a **scoped accessor** `item` — a function `<R>(selector: (t: T) => R) => R` — and an index accessor `index: () => number`. When the developer writes `item(t => t.text)`, the framework internally creates a binding whose accessor is a zero-argument closure: `() => selector(currentItemRef)`. Because this closure has `length === 0`, the binding is tagged `perItem: true` at creation time.

In Phase 2, if `ownerScope.eachItemStable` is true, all `perItem` bindings are skipped entirely without calling their accessor. This is correct because a `perItem` binding's value can only change if the item reference itself changes — but `eachItemStable` is only set when the item reference is identical to the previous cycle (`Object.is(existing.item, newItem)`). The accessor call, value comparison, and potential DOM write are all eliminated.

The scoped accessor pattern means the developer never needs to manage closure semantics manually. Writing `item(t => t.text)` in the render callback produces the correct reactive binding with per-item stability automatically. The framework handles the closure wrapping internally — the developer writes a selector, the runtime creates the optimized zero-arg binding.

For components rendering large lists where most items are stable between updates, this optimization eliminates the entire Phase 2 cost for stable entries. A Select benchmark where only the selected state changes: the selected item's bindings run, all other items' perItem bindings are skipped. An Update-every-10th benchmark: only affected entries pay for accessor evaluation. An array-reference-same fast path: the entire each block exits in Phase 1 before any binding is touched.

---

## Structural Primitives

### `branch()`

`branch()` implements conditional rendering keyed on a discriminant. It inserts a placeholder comment node at the position where the conditional content should appear, then replaces the live nodes between the placeholder and the next sibling on each discriminant change.

```
// At render time:
const placeholder = document.createComment('branch')
parent.appendChild(placeholder)
block.lastKey = undefined
block.activeScope = null
block.activeNodes = []

// At reconcile time (Phase 1):
function reconcileBranch(block, state) {
  const newKey = block.discriminant(state)
  if (newKey === block.lastKey) return

  // Tear down old case
  if (block.activeScope) {
    const leave = block.transitions?.leave
    const oldNodes = block.activeNodes
    if (leave) {
      leave(oldNodes).then(() => {
        oldNodes.forEach(n => n.parentNode?.removeChild(n))
      })
    } else {
      oldNodes.forEach(n => n.parentNode?.removeChild(n))
    }
    block.activeScope.dispose()
    block.activeScope = null
    block.activeNodes = []
  }

  block.lastKey = newKey
  const caseBuilder = block.cases[newKey]
  if (!caseBuilder) return

  // Build new case
  const newScope = createScope(block.ownerScope)
  const newNodes = []
  caseBuilder(newScope, newNodes)
  block.activeScope = newScope
  block.activeNodes = newNodes

  // Insert after placeholder
  const frag = document.createDocumentFragment()
  newNodes.forEach(n => frag.appendChild(n))
  block.placeholder.parentNode.insertBefore(frag, block.placeholder.nextSibling)

  const enter = block.transitions?.enter
  if (enter) enter(newNodes)
}
```

The placeholder comment node is what makes this composable. Multiple branch blocks can coexist inside the same parent without knowing about each other's positions. The placeholder's `nextSibling` is always the correct insertion anchor regardless of how many sibling branches or each blocks share the parent.

The leave/enter hook model fires leave before removal and enter after insertion. This is the only correct ordering for CSS transitions: leave needs the nodes to still be in the document to measure their starting position; enter needs the nodes to be in the document to receive the CSS class that triggers the animation.

The branch case scope is a direct child of the scope that owns the branch block. When the discriminant changes, `block.activeScope.dispose()` propagates depth-first through any nested branches or each blocks inside the active case, cleaning up their bindings and event listeners before the nodes are removed. This means leaving a route never leaks a timer, a fetch abort controller, or a WebSocket listener regardless of how deeply nested the component tree is.

### `each()`

`each()` takes four arguments: `items` (a state accessor returning the array), `key` (a function mapping each raw item value to a unique key), `render` (a builder callback), and optional transition hooks. The `key` function receives the **raw item value** `T` — it runs during reconciliation to identify entries and does not need reactivity. The `render` callback receives a **scoped accessor** `item: <R>(selector: (t: T) => R) => R` and an index accessor `index: () => number` — not the raw item. This asymmetry is intentional: `key` is a pure identity function evaluated during Phase 1, while `render` produces reactive bindings that participate in Phase 2's per-item stability optimization (see "The `perItem` Optimization" below).

`each()` is the most algorithmically complex primitive because list reconciliation has O(n) best cases and O(n log n) worst cases depending on what changed, and the common cases must be essentially O(1).

The reconciliation algorithm proceeds in stages:

**Stage 0 — Array identity fast path.**

```
if (Object.is(newItems, block.lastItems)) {
  for (const entry of block.entries) {
    entry.scope.eachItemStable = true
  }
  return  // no DOM work at all
}
block.lastItems = newItems
```

When the array reference is identical to the previous cycle, no item could have been added, removed, or replaced. Mark all entry scopes stable and return immediately. This is O(n) in entry count (to set the flag) but zero DOM work.

**Stage 1 — Key-based entry matching.**

Build a map from key to existing entry. Iterate `newItems`:

- If the key exists in the map: reuse the entry; update item and index closures; set `eachItemStable = (newItem === entry.lastItem)`.
- If the key does not exist: allocate a new scope, execute the item builder, record nodes; add to additions list.

Entries whose keys are absent from `newItems`: dispose scope, record for DOM removal (with optional leave transition).

**Stage 2 — DOM reordering.**

This is where the algorithm earns its keep. Two sub-cases:

_No additions or removals (same key set, possibly reordered):_

```
const diffs = survivingEntries.filter(
  (e, i) => e !== block.entries[i]
)
if (diffs.length === 0) return  // no-op

if (diffs.length === 2) {
  const [a, b] = diffs
  // Targeted 2-fragment swap
  const aFirst = a.nodes[0], aLast = a.nodes[a.nodes.length - 1]
  const bFirst = b.nodes[0]
  parent.insertBefore(bFirst, aFirst)  // move b to before a's position
  parent.insertBefore(aFirst, bFirst.nextSibling ?? block.endPlaceholder)
  // ... handle multi-node fragments correctly
  return
}

// Full fragment rebuild
const frag = document.createDocumentFragment()
for (const entry of newOrder) {
  entry.nodes.forEach(n => frag.appendChild(n))
}
parent.insertBefore(frag, block.endPlaceholder)
```

The 2-diff swap is motivated by drag-and-drop: in a typical drag operation, the user moves one item to a new position. The reconciler identifies exactly two entries out of place and swaps only those two DOM fragments. For a list of 100 items where one was moved, this is 2 DOM operations instead of 100.

_Additions or removals present:_

Check whether the surviving entries are already in their correct relative order using an O(n) longest-increasing-subsequence length check:

```
function survivorsInOrder(oldEntries, newOrderMap) {
  let maxSeen = -1
  for (const entry of oldEntries) {
    const newIndex = newOrderMap.get(entry.key)
    if (newIndex === undefined) continue  // being removed
    if (newIndex > maxSeen) {
      maxSeen = newIndex
    } else {
      return false  // order violation
    }
  }
  return true
}
```

If survivors are in order: only insertions need DOM work. Additions that all land at the tail are batched into a single `DocumentFragment` append. Intermediate additions are inserted in reverse order (high index first) to avoid position drift, each as a single `insertBefore`.

If survivors are out of order: full fragment rebuild. All entries (surviving and new) are appended to a fragment in new order, then inserted in one operation.

The full fragment rebuild path is O(n) DOM operations but only one layout-triggering reflow trigger, because all mutations happen before the browser recalculates layout.

**Tradeoff: why not always full-rebuild?**

Because for large stable lists with occasional appends (infinite scroll, log tailing), full rebuild moves every node even when 99% are unchanged. The `insertBefore` on 10,000 nodes is measurable latency. The order-preserving path leaves them untouched.

### `show()`

`show()` is a two-case `branch` keyed on a boolean discriminant. When the condition becomes false, the active scope is disposed and nodes are removed — exactly like `branch` switching arms. When the condition becomes true again, the builder re-runs, creating a fresh scope and fresh nodes. There is no scope persistence across hide/show cycles.

This means `show()` and `branch()` have identical lifetime semantics: only the currently active case's scope is alive. The difference is ergonomic — `show()` is a convenience for the common pattern of "render this or nothing" without requiring the developer to write a two-case `branch` with an explicit empty builder.

---

## The Scope Hierarchy

A scope is a node in a tree whose only job is to hold a list of disposers and a list of owned bindings. It has no knowledge of the DOM structure it covers.

```
interface Scope {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  eachItemStable: boolean
}

function createScope(parent: Scope | null): Scope {
  const scope = { id: nextId++, parent, children: [], disposers: [], bindings: [], eachItemStable: false }
  parent?.children.push(scope)
  return scope
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

The disposers list holds anything that has an external side effect: `removeEventListener` callbacks, `ResizeObserver` disconnect calls, `IntersectionObserver` disconnect calls, portal node removal functions, child component teardown functions (Level 2 `child()` unmount), `onMount` cleanup callbacks, and props watcher unregistration. Each of these is registered by calling `scope.disposers.push(fn)` at creation time.

Depth-first disposal is required for correctness when child scopes hold references to resources that parent scope cleanup expects to be live. For example, a child component may have registered a portal node in the parent document; the child's disposer removes that portal node; the parent's disposer then safely cleans up the portal container. Reversing the order would leave dangling DOM nodes.

The scope hierarchy mirrors the conceptual nesting of the view: a branch scope is a child of the scope that owns the branch block; each entry scopes are children of the each scope. This means `disposeScope(branchScope)` recursively cleans up everything the active case ever created, regardless of how deeply nested.

This is the right unit of lifetime management because it is the only unit that captures the structural lifecycle of a subtree. Component-level lifecycle (mounted/unmounted) is not granular enough: a single component may contain multiple branch blocks, each with independent lifetimes. Event-based subscriptions require explicit pairing of subscribe/unsubscribe. Scopes require neither: anything registered with a scope is automatically cleaned up when the scope is disposed, which happens exactly when the DOM subtree it covers is removed.

The consequence is that "forgot to unsubscribe" is structurally impossible. There is no API that creates a subscription without also requiring a scope argument. The scope is the subscription's lifetime. Memory leaks from stale listeners require actively avoiding the scope system, which the framework APIs do not permit.

---

## What Adds Value

**Phase separation.** The guarantee that Phase 2 never touches a binding belonging to a disposed scope is worth the architectural cost of splitting structural and binding updates. Without it, every update would require either a liveness check per binding (adding a conditional to the hot loop) or a two-pass approach anyway.

**Three-level identity checks.** Same array reference in `Object.is(newItems, block.lastItems)` eliminates Phase 1 reconciliation entirely. Same item reference sets `eachItemStable`, eliminating all perItem Phase 2 binding evaluations for that entry. Same value reference in `Object.is(newValue, binding.lastValue)` eliminates the DOM write. Each level independently removes work proportional to the degree of stability.

**The flat binding array.** A tree traversal of the scope hierarchy on every update would be O(scope count). The flat array, pre-filtered by mask, makes Phase 2 proportional to `|bindings with matching mask|`, which is often a small constant regardless of component size.

**Scope as lifetime unit.** Composable, zero-overhead at runtime (no reference counting, no GC root management), impossible to misuse through the framework APIs.

**Targeted 2-swap detection.** In drag-and-drop scenarios (one item moved per interaction), this reduces DOM work from O(n) to O(1). The 2-fragment swap executes 2-4 `insertBefore` calls; a full rebuild would execute n `appendChild` calls. At 100 items, the difference is visible in frame timing.

**Batch tail insert.** Append-only lists (infinite scroll, log tailing) hit this path on every load event. One `DocumentFragment` append versus n individual `insertBefore` calls reduces reflow triggers from n to 1.

---

## What to Avoid

**Virtual DOM diffing.** VDOM adds overhead proportional to tree size on every update regardless of what changed. LLui's binding model already knows exactly which DOM nodes need updating (bindings are registered to specific nodes) and exactly which bindings could be affected (mask check). VDOM solves a problem the binding model does not have.

**Re-running `view()` on state changes.** `view()` creates DOM nodes and registers bindings. Running it again on a state change would create duplicate nodes and duplicate bindings. The correct model is: `view()` runs once to create structure; the update cycle runs repeatedly to propagate values. Conflating them forces O(tree size) work for O(1) state changes.

**Synchronous DOM mutations inside event handlers.** Calling `element.textContent = ...` directly inside a click handler bypasses the update cycle. The state field that controls that text may be in the middle of being read by another binding. Even if this works today, it creates a race between the event handler's mutation and the pending microtask update that will overwrite it. All mutations must go through `send()` to guarantee they are applied in a coherent cycle. If imperative DOM reads are needed immediately after a state change, use `send()` followed by `flush()` — not direct DOM mutation.

**Global `MutationObserver` for change tracking.** A MutationObserver watching the entire document fires on every DOM mutation, including those caused by the update cycle itself. This creates feedback loops and makes it impossible to distinguish framework mutations from external ones without adding expensive bookkeeping. It also removes the ability to reason locally about what triggers an update.

**Per-binding subscriptions (reactive pull model / MobX model).** Each binding holding its own subscription to the state fields it reads doubles the object count per binding, adds indirection through subscription queues, and requires GC pressure from subscription object allocation and deallocation. The bitmask model achieves the same selectivity with a single integer comparison.

---

## What Seems Valuable But Isn't

**WeakMap-based binding lookup.** Accessing a binding by its DOM node via a WeakMap would allow O(1) lookup if you needed to find the binding for a given node. But Phase 2 never looks up by node — it iterates the flat array sequentially. The WeakMap would only help if the update loop were node-centric rather than binding-centric. It isn't. The lookup cost is zero because the lookup never happens; the WeakMap adds GC pressure (WeakMap internals use ephemeron tables that are more expensive to traverse than plain arrays) for no benefit.

**Eager binding disposal when value doesn't change.** A binding whose accessor currently returns the same value as `lastValue` is still needed: the next state update might change the value, and the binding must be present to apply it. Removing a binding from the flat array when its value hasn't changed would require re-adding it when the value does change, which requires a second data structure to track "suspended" bindings and a way to unsuspend them — more complexity for zero benefit.

**`requestAnimationFrame` batching for DOM writes.** Phase 2 DOM writes are already batched: all writes in a single update cycle execute synchronously before the browser has any opportunity to recalculate layout. The microtask that triggers the update cycle runs after synchronous JavaScript execution completes and before the browser's rendering steps. Adding `rAF` introduces a full animation frame of latency (16ms at 60fps) with no correctness improvement. The argument for `rAF` is that it coalesces multiple microtask updates into one render step — but LLui's `send()` already coalesces via the message queue: all sends within the same synchronous execution are drained in one `processMessages` pass, producing one combined dirty mask and one DOM update. `rAF` would add latency for zero additional coalescing benefit.

**Fine-grained per-path subscriptions.** Rather than one bitmask per binding, one could allocate a subscription object per `(binding, path)` pair. This enables more precise invalidation — a binding that reads paths A and B would only re-evaluate when A changes even if B also changed — but the bitmask already provides this: the mask is set per binding, and the `(binding.mask & dirtyMask) === 0` check skips the binding if none of its paths changed. With path-level tracking (the compiler assigns bits to `s.user.name` and `s.user.email` separately), the granularity of the bitmask approach matches per-path subscriptions for the common case of depth-2 state shapes. The only scenario where per-path subscriptions would help beyond what bitmasks provide is if a single binding reads two paths but should only re-run when one of them changes. That scenario doesn't arise in practice because an accessor that reads two paths produces a value that depends on both; if either changes, the value might change, and the accessor must be called.

**Virtual DOM for `branch()` cases.** Branch is not like VDOM: it doesn't need to diff two trees because it has a key that identifies which case is active. When the key changes, the old case is wholly removed and the new case is wholly inserted. There is nothing to diff. VDOM would add tree construction overhead on every case transition — which is precisely when performance matters most (animation entry points, route transitions) — for zero reduction in DOM work.

---

## Open Questions and Future Directions

**Morphdom integration for SSR hydration and third-party widgets.** When a server renders HTML that the client then takes over, LLui's current model creates DOM nodes from scratch and inserts them — which is correct but discards the server-rendered HTML. Morphdom (or a similar "reconcile existing DOM" approach) would allow the hydration path to walk the existing server HTML and attach bindings to existing nodes rather than creating new ones. The challenge is that `view()` is written assuming it creates nodes; separating node creation from binding registration would require a builder API change. This is worth prototyping because streaming hydration (send HTML, attach JS incrementally) is the primary path to improved time-to-interactive.

**CSS transition integration.** The enter/leave hook model in `branch()` and `each()` is architecturally correct but battle-tested only against simple opacity/transform transitions. Edge cases include: leave transition interrupted by a new discriminant change before the leave promise resolves; enter transition on an item that is immediately removed by another state change; nested transitions (a branch inside an each entry where both animate). The current model does not define behavior for these cases; real animation libraries (Framer Motion, GSAP) have well-defined interruption semantics that the hook model should match.

**Streaming hydration.** Full streaming hydration separates HTML delivery from JavaScript binding activation. The server streams HTML chunks; the client renders them immediately (no blank page); once the JS bundle loads, the runtime attaches bindings to existing nodes. This requires that `view()` can run in "hydration mode" where it finds existing nodes rather than creating them, and that the server and client agree on scope boundaries (via comment markers or data attributes). The placeholder comment nodes LLui already uses for branch and each are a natural fit for marking scope boundaries in server HTML.

**SharedArrayBuffer state for Web Worker coordination.** Heavy computation (sorting large datasets, parsing, AI inference) blocks the main thread. Moving state into a `SharedArrayBuffer` would allow a worker to write state fields and atomically update the dirty mask, with the main thread polling (or being notified via `Atomics.waitAsync`) and triggering an update cycle. The bitmask model maps directly to atomic integer operations. The challenge is that accessor functions run on the main thread and read from the SharedArrayBuffer, requiring careful atomicity semantics to avoid torn reads.

**Incremental reconciliation for very large lists.** A `each()` list with 10,000 items where 5,000 items change in one update cycle will block the main thread during Phase 1 reconciliation. Time-slicing structural updates — reconciling a batch of entries per animation frame, deferring the rest — would keep the UI responsive at the cost of visible partial updates. The question is whether the partial-update state is visually acceptable (a list that is partially updated mid-scroll is probably not) or whether incremental reconciliation requires a two-buffer model (build the new DOM off-screen, swap when complete). The latter is equivalent to virtual scrolling for updates, which has well-understood semantics.

**Pooled DOM node reuse for high-churn `each()` lists.** Typeahead results, autocomplete dropdowns, and real-time search results replace the entire list on every keystroke. The current model disposes old entry scopes and creates new ones, allocating new DOM nodes for each new item. A pool of reusable `(scope, nodes)` pairs that are reset and reissued rather than discarded would reduce GC pressure and DOM allocation cost. The challenge is that builder functions assume they are initializing fresh nodes; pooling requires the ability to reset a scope's closures and DOM state to a new item without re-running the builder, which implies a clean separation between structure (built once, reused) and content (rebound on each reuse). This is essentially the component recycling model used in Android RecyclerView and iOS UITableView, adapted to the DOM.

---

## DOM Pattern Reference

**Drag and drop.** Each list with reordering hits the 2-swap path on every drop event: the dragged item and its destination neighbor are the only two entries out of position. Phase 1 identifies exactly two diffing entries, executes 4 `insertBefore` calls to swap their node fragments, and returns. Binding updates in Phase 2 are limited to the two reordered entries' index bindings (if the view displays position numbers). The O(1) swap is what makes drag-and-drop feel immediate rather than janky.

**Animated route transitions.** Branch keyed on the current route discriminant (e.g., `'/home'`, `'/settings'`) fires leave on the exiting route and enter on the entering route. The leave hook adds a CSS class that triggers an exit animation, returns a Promise that resolves when `transitionend` fires, and only then removes the nodes. The enter hook adds a CSS class after insertion to trigger the entry animation. Timing is critical: if nodes are removed before the exit animation completes, the animation is cut off; if the enter class is added before nodes are in the document, the transition has no starting point to animate from.

**Infinite scroll.** An append-only each list that receives new items at the tail on every scroll event hits the batch-tail-insert fast path: surviving entries are in order (no reordering), all additions land at the tail, and a single `DocumentFragment` append covers the entire batch. Phase 2 skips all stable entries via `eachItemStable`. The per-scroll update cost is proportional to the number of new items only, not the total list length.

**Modal and tooltip via portal.** A `portal()` builder inserts nodes into `document.body` (or another target) outside the component's natural DOM position. The portal's scope is a child of the originating component's scope, so disposal (modal closed, tooltip dismissed) correctly removes the body-level nodes and cleans up any event listeners the portal content registered. `show()` wrapping the portal trigger disposes the portal scope when hidden and recreates it when shown — no binding costs while the modal is closed.

**Typeahead.** A `show()` wrapping a results dropdown opens and closes on every keystroke. Because `show()` disposes its scope on hide and rebuilds on show, each re-open runs the builder fresh — but this is typically cheap (the `each()` inside is driven by the current results array, which is already in state). The `each()` inside the dropdown uses string keys (result IDs or normalized text), so rapid full replacement of the result set (common when the query changes significantly) goes through the full fragment rebuild path, which is one DocumentFragment insertion. The critical concern is that transition timing must not flicker: if the leave transition has a non-zero duration, a rapid open/close/open sequence must either cancel the in-progress leave transition or queue the re-open correctly.

**Tree view.** A recursive `each()` where each entry may itself contain an `each()` for children creates a scope hierarchy of arbitrary depth. Collapsing a node disposes its child each scope depth-first, removing all descendant entry scopes before the parent scope's nodes are detached. For a tree with 500 visible nodes, collapsing the root disposes 499 entry scopes in depth-first order. The disposal is synchronous and O(total descendants), which is correct but may be slow for very deep trees; incremental disposal is an open question here.

**Data table with frequent full replacement.** A table where the entire dataset is replaced on every sort or filter operation (common in server-driven tables) discards all existing entry scopes and creates new ones in Phase 1. The full fragment rebuild path appends all new entry nodes to a DocumentFragment and inserts it in one operation. Phase 2 then evaluates all bindings for all new entries (no `eachItemStable` since all are new). For a table with 100 rows and 10 bindings per row, Phase 2 does 1000 accessor calls and 1000 DOM writes on a full replace. This is the worst case for the binding model; the optimization available is to minimize binding count per row by collapsing multiple related fields into a single binding where possible.

---

## Runtime Optimizations (Implemented)

### Per-Item Direct Updaters

Per-item bindings (those with `accessor.length === 0`, created by `item(selector)` calls in `each()` render callbacks) bypass the `allBindings` array entirely. Instead, they are registered as **item updaters** on the scope via `scope.itemUpdaters`. When `each()`'s reconciler detects an item change (`!Object.is(oldItem, newItem)`), it directly invokes the updaters:

```typescript
function updateEntry(entry, item, index) {
  const changed = !Object.is(entry.item, item)
  entry.current = item
  entry.scope.eachItemStable = !changed
  if (changed) {
    for (const updater of entry.scope.itemUpdaters) updater()
  }
}
```

This eliminates per-item binding objects from `allBindings`, reducing Phase 2 scan cost from O(all bindings) to O(state-level bindings only). For a 1000-row list with 3 bindings per row (1 state-level class + 2 per-item text), Phase 2 scans 1000 bindings instead of 3000.

### Fresh Binding Skip

Bindings created during Phase 1 (structural reconciliation) already have their initial values set at creation time. Phase 2 should not re-evaluate them. The update loop snapshots `allBindings.length` before Phase 1 and only iterates up to that length in Phase 2:

```typescript
const bindingsBeforePhase1 = bindings.length
// Phase 1 — creates new entries and bindings...
// Phase 2 — only iterate pre-existing bindings
for (let i = 0; i < bindingsBeforePhase1; i++) { ... }
```

This eliminates wasted accessor evaluations on create/replace operations where thousands of bindings are freshly created.

### Scope Disposal Reference Cleanup

When a scope is disposed, binding objects have their `accessor`, `node`, and `lastValue` fields nulled immediately. This breaks closure and DOM retention chains, ensuring that disposed DOM trees become eligible for GC without waiting for Phase 2 compaction to remove dead bindings from `allBindings`.
