# Anchor-based mount primitive for `@llui/dom` and comment-based `pageSlot()` for `@llui/vike`

**Date:** 2026-04-17
**Status:** Design approved; pending implementation plan
**Scope:** Two new `@llui/dom` exports (`mountAtAnchor`, `hydrateAtAnchor`). `@llui/vike`'s `pageSlot()` changes to emit a comment marker. Sentinel-pair ownership model. HMR integration. Breaking DOM-shape change for `pageSlot` consumers.

---

## 1. Motivation

`@llui/vike`'s `pageSlot()` currently returns a `<div data-llui-page-slot="">` element. The div is a structural handoff point for the Vike adapter — it serves as the `container` argument to the next layer's `mountApp` / `hydrateApp` call. App authors cannot style or set attributes on the slot (because `pageSlot()` takes no options), and they also cannot remove it — every persistent-layout slot adds a wrapper element to the DOM that the author did not ask for.

LLui already uses comment markers as anchors elsewhere (`show`, `branch`, `each`, `child` all place `<!-- ... -->` placeholders in the DOM to track insertion points). Making `pageSlot()` consistent with that pattern would eliminate the spurious wrapper. The blocker is that `mountApp` / `hydrateApp` take an `HTMLElement` container — they call `container.appendChild` / `container.replaceChildren`, which a `Comment` cannot satisfy.

This design adds two new `@llui/dom` primitives — `mountAtAnchor` and `hydrateAtAnchor` — that mount relative to a comment anchor instead of inside a container element, using a **sentinel-pair** model to own the inserted region. `@llui/vike` switches `pageSlot()` to emit a comment and the adapter to use the new primitives. The new mount primitives are publicly exported, so any caller (not just vike) can mount components at a comment anchor — e.g., embedding reactive components inside markdown-rendered content.

---

## 2. High-level architecture

### 2.1 Sentinel-pair ownership

An anchor-mounted component owns the DOM region bounded by two comment nodes:

```
<!-- caller-owned anchor (e.g. "llui-page-slot") -->
  ...component's mounted nodes...
<!-- llui-mount-end -->       ← synthesized by mountAtAnchor/hydrateAtAnchor
```

- The **start anchor** is owned by the caller. It must already be attached to a live DOM tree when `mountAtAnchor` / `hydrateAtAnchor` is invoked. The primitive never removes it.
- The **end sentinel** is synthesized and owned by the primitive. It is removed on dispose.
- The mounted component's nodes live as siblings between the pair.
- Ownership is positional, not identity-based: top-level `each` / `show` / `branch` inside the mounted component can freely add or remove siblings within the pair across the component's lifetime, and dispose still cleans them up correctly because dispose walks between the sentinels rather than iterating a snapshot list.

### 2.2 Why positional (sentinel-pair) ownership

A snapshot-based approach (`ownedNodes: Node[]` captured at mount) would leak any top-level DOM added after mount — e.g., a component whose `view()` returns `[each(items, ...)]` has only the each-anchor in the snapshot, and rows appended later are invisible to dispose. The sentinel-pair approach makes ownership a region, not a set, so any top-level mutation within that region is automatically included in cleanup.

### 2.3 Where this fits in the mount surface

```
@llui/dom entry points (existing + new):

  mountApp(container: HTMLElement, def, data?, opts?)   -- existing, unchanged
  hydrateApp(container: HTMLElement, def, state, opts?) -- existing, unchanged
  mountAtAnchor(anchor: Comment, def, data?, opts?)     -- new
  hydrateAtAnchor(anchor: Comment, def, state, opts?)   -- new
```

All four return the same `AppHandle` (`{ dispose, flush, send }`) and accept the same `MountOptions` (`devTools?`, `parentScope?`). No public API changes to the container-based entry points.

---

## 3. API

### 3.1 `mountAtAnchor`

```ts
export function mountAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  options?: MountOptions,
): AppHandle
```

Contract:

- Throws immediately if `anchor.parentNode === null`.
- Walks forward from `anchor.nextSibling` looking for a pre-existing end sentinel. If one is found (stale from a prior undisposed mount), sweeps everything between `anchor` and the found sentinel and reuses the sentinel — with a dev-mode `console.warn` advising the caller to dispose prior mounts.
- If no pre-existing end sentinel is found, synthesizes one (`document.createComment('llui-mount-end')`) and inserts it at `anchor.nextSibling`.
- Runs `createComponentInstance(def, data, options?.parentScope ?? null)` — identical to `mountApp`.
- Sets `RenderContext.container = anchor.parentElement` during the view pass so `onMount(callback)` receives the closest containing element. (See §3.4 for the semantic note.)
- Runs `def.view(...)` in a render context; collects the returned `Node[]`.
- Inserts each node via `anchor.parentNode.insertBefore(node, endSentinel)`. Uses a `DocumentFragment` when `nodes.length > 1`, matching `mountApp`'s batching.
- Flushes the onMount queue synchronously.
- Registers with HMR if the dev-only HMR module is loaded (see §5).
- Returns an `AppHandle` whose `dispose()`:
  1. Aborts `inst.abortController`, unregisters from global instance registry.
  2. Tags `inst.rootScope.disposalCause = 'app-unmount'`.
  3. Calls `disposeScope(inst.rootScope)`.
  4. Walks siblings from `anchor.nextSibling` to `endSentinel` (exclusive), `removeChild`-ing each.
  5. Removes `endSentinel` itself.
  6. Unregisters from HMR if applicable.

### 3.2 `hydrateAtAnchor`

```ts
export function hydrateAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  serverState: S,
  options?: MountOptions,
): AppHandle
```

Contract:

- Same pre-flight checks as `mountAtAnchor`.
- Walks forward from `anchor.nextSibling` looking for an `<!-- llui-mount-end -->` sentinel. If found, reuses it; if not, synthesizes one at `anchor.nextSibling` (identical to `mountAtAnchor`). Never throws for missing sentinel — the vike chain's outer `hydrateApp` does `container.replaceChildren(...)` which wipes inner layers' server content and their end sentinels, so inner-layer `hydrateAtAnchor` calls routinely find nothing to reuse.
- Builds the client-side component fresh (`createComponentInstance` with `serverState` via the same technique `hydrateApp` uses: discards `init()`'s state but preserves its effects).
- Atomic-swap: removes every sibling between `anchor` and the end sentinel (whether found or freshly synthesized); inserts the client's freshly-built nodes in the same position.
- Flushes onMount; dispatches initial effects; registers HMR.
- `dispose()` is identical to `mountAtAnchor`'s.

The semantic distinction between `mountAtAnchor` and `hydrateAtAnchor` is which path `createComponentInstance` takes — `mountAtAnchor` runs `init()` normally; `hydrateAtAnchor` uses `serverState` as the initial state and preserves `init()`'s effects for post-mount dispatch (same as the distinction between `mountApp` and `hydrateApp`). The DOM-handling path is identical.

### 3.3 Deferred: true DOM-reuse hydration

Atomic-swap is a known compromise — the client discards the server's DOM rather than reusing it. Both `hydrateApp` and `hydrateAtAnchor` share this limitation. A future proposal (`docs/proposals/true-dom-reuse-hydration.md`) covers walking the server tree and binding to existing nodes; once that lands, it changes both primitives' swap step without affecting their signatures.

### 3.4 Semantic change: `RenderContext.container` for anchor-mounted components

In `mountApp` / `hydrateApp`, `RenderContext.container` is the element that will own the mounted nodes as children. `onMount(callback)` receives that element.

For anchor-mounted components, the mounted nodes live as siblings of the anchor inside `anchor.parentElement`. That parent element is the **closest containing element**, but it is not a wrapper exclusive to the component — it may hold arbitrary sibling DOM from the outer layer.

`mountAtAnchor` / `hydrateAtAnchor` pass `anchor.parentElement` to `RenderContext.container`. `onMount(callback)` receives this element. The JSDoc on `onMount` is updated to describe the new semantic explicitly.

Real-world `onMount` usage is dominated by `IntersectionObserver`, resize observers, global keyboard listeners, and "am I still in the DOM?" checks — all of which are well-served by the parent element. Consumers that want a wrapper exclusive to their component must add their own wrapping element inside `view()`.

### 3.5 `@llui/vike` changes

**`pageSlot()`:**

```ts
export function pageSlot(): Node[] {
  // ... existing guards ...
  const slotScope = createScope(ctx.rootScope)
  const anchor = document.createComment('llui-page-slot')
  pendingSlot = { slotScope, anchor }
  return [anchor]
}
```

**`PendingSlot` shape:**

```ts
interface PendingSlot {
  slotScope: Scope
  anchor: Comment // was: marker: HTMLElement
}
```

**`ChainHandle` shape (in `on-render-client.ts`):**

```ts
interface ChainHandle {
  def: AnyComponentDef
  handle: AppHandle
  slotAnchor: Comment | null // was: slotMarker: HTMLElement | null
  slotScope: Scope | null
  data: unknown
}
```

**`on-render-html.ts` stitching:** instead of `currentSlotMarker.appendChild(node)`, maintain an `insertPoint` cursor that starts at `anchor.nextSibling` and advances. Insert each inner-layer node via `anchor.parentNode!.insertBefore(node, insertPoint)`. After the last inner-layer node of a given layer, insert the end sentinel (`document.createComment('llui-mount-end')`) at the current `insertPoint` — this is what `hydrateAtAnchor` will discover on the client.

**`on-render-client.ts` mount/hydrate:** replace `hydrateApp(mountTarget, ...)` / `mountApp(mountTarget, ...)` with `hydrateAtAnchor(mountAnchor, ...)` / `mountAtAnchor(mountAnchor, ...)`. For the outermost layer (i.e., the root container), the existing `hydrateApp` / `mountApp` remains — the root container is a real `HTMLElement` passed in by Vike.

**`on-render-client.ts` nav swap:** replace `leaveTarget.textContent = ''` with iterating `chainHandles[i].handle.dispose()` for the divergent suffix (already done); the new `dispose()` semantics do the sentinel-pair removal, so no direct DOM manipulation at the chain level is needed.

---

## 4. Data flow / lifecycle

### 4.1 SSR path

```
1. Vike calls renderNodes(LayoutA, stateA)                       # @llui/vike
2. LayoutA.view() runs; pageSlot() emits [<!-- llui-page-slot -->]
3. _consumePendingSlot() → { anchor, slotScope }
4. Vike calls renderNodes(PageB, stateB, slotScope)               # parentScope
5. Stitch: for each node in PageB's nodes:
     anchor.parentNode.insertBefore(node, insertPoint)
     insertPoint = node.nextSibling
6. Insert end sentinel: anchor.parentNode.insertBefore(
     document.createComment('llui-mount-end'), insertPoint)
7. serializeNodes(outermostNodes, unionBindings) → HTML string
8. Comments serialize as <!-- ... --> via existing ssr.ts path
```

Final emitted HTML for the slot region:

```html
<main>
  <!-- llui-page-slot -->
  <div class="page">...</div>
  <!-- llui-mount-end -->
</main>
```

### 4.2 Hydration path

```
1. Client fetches HTML. window.__LLUI_STATE__ envelope has layouts + page.
2. hydrateApp(rootEl, LayoutA, envelope.layouts[0].state)          # container-based
   → container.replaceChildren(...clientNodes) wipes ALL server DOM
     including inner layers' stitched content and their end sentinels
3. During LayoutA's view: pageSlot() creates fresh Comment + Scope
4. _consumePendingSlot() → { anchor, slotScope }
5. chainHandles[0].slotAnchor = anchor (the fresh client comment)
6. For i = 1..chain.length - 1:
     hydrateAtAnchor(chainHandles[i-1].slotAnchor, chain[i].def,
                     envelope.layouts[i]?.state ?? envelope.page.state,
                     { parentScope: chainHandles[i-1].slotScope })
7. hydrateAtAnchor finds NO end sentinel (outer hydrateApp wiped it),
   so it synthesizes one and mounts fresh with serverState as initial.
   Subsequent inner layers repeat: each inner hydrateAtAnchor's
   predecessor wiped its slot region, so every inner hydrate is effectively
   a fresh mount using serverState. This is identical to what the existing
   pre-anchor codebase already does (hydrateApp on an empty container).
```

Note: the SSR path DOES emit end sentinels (see §4.1 step 6). They exist in the server HTML, survive initial DOM parsing, and would normally guide hydration — but they are wiped by the outer container-based `hydrateApp`'s `replaceChildren` call before any `hydrateAtAnchor` runs. Keeping SSR emission is still valuable because the end sentinels are visible to DOM inspection before hydration, clearly delimiting each layer's content in the raw server HTML. A future DOM-reuse hydration (see §3.3) will stop wiping them and will rely on them for walker-based reconciliation.

### 4.3 Client-nav swap

```
1. firstMismatch identified in chain comparison.
2. For i = chainHandles.length - 1 down to firstMismatch:
     chainHandles[i].handle.dispose()
       → scope disposal
       → remove siblings between anchor and endSentinel
       → remove endSentinel
3. chainHandles = chainHandles.slice(0, firstMismatch)
4. Mount new suffix:
     For i = firstMismatch..newChain.length - 1:
       if (i === 0) mountApp(rootEl, newChain[0], ...)
       else         mountAtAnchor(chainHandles[i-1].slotAnchor, newChain[i], ...)
```

### 4.4 Dispose

Identical for `mountAtAnchor` and `hydrateAtAnchor` handles:

```
1. inst.abortController.abort()
2. unregisterInstance(inst)
3. HMR unregister (if applicable)
4. inst.rootScope.disposalCause = 'app-unmount'
5. disposeScope(inst.rootScope)
6. while (anchor.nextSibling && anchor.nextSibling !== endSentinel)
     anchor.parentNode.removeChild(anchor.nextSibling)
7. anchor.parentNode.removeChild(endSentinel)
```

---

## 5. HMR integration

`@llui/dom`'s `hmr.ts` currently tracks `{ inst, container }` entries per component name. The replace flow does `container.textContent = ''` then `container.appendChild(newNodes)`.

### 5.1 New entry shape

Extend the registration payload to a discriminated union:

```ts
type HmrEntry =
  | { kind: 'container'; inst: ComponentInstance; container: HTMLElement }
  | { kind: 'anchor'; inst: ComponentInstance; anchor: Comment; endSentinel: Comment }
```

### 5.2 Replace flow

For `kind: 'container'`: unchanged.

For `kind: 'anchor'`:

1. Walk siblings from `anchor.nextSibling` to `endSentinel` (exclusive), `removeChild` each.
2. Build fresh instance from the new `def`.
3. Insert fresh nodes via `anchor.parentNode.insertBefore(node, endSentinel)`.
4. Preserve `endSentinel` (same node reference).
5. Return a new `AppHandle` wired to the same anchor/endSentinel pair.

### 5.3 Registration from mount primitives

`mountAtAnchor` / `hydrateAtAnchor` call `hmrModule.registerForAnchor(name, inst, anchor, endSentinel)` analogous to the existing `registerForHmr(name, inst, container)`. The existing `registerForHmr` stays for container-based mounts.

---

## 6. Error handling

| Situation                                                                               | Behavior                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor.parentNode === null` at `mountAtAnchor` / `hydrateAtAnchor` entry               | Throw: `"[LLui] mountAtAnchor: anchor comment must be attached to a live DOM tree before mount"`                                                |
| `mountAtAnchor` / `hydrateAtAnchor` finds a stale end sentinel (prior undisposed mount) | Dev-only `console.warn` recommending dispose; proceed by sweeping stale siblings and reusing the sentinel                                       |
| `hydrateAtAnchor` finds no end sentinel after the anchor                                | Synthesize one, proceed as fresh mount. Normal in the vike chain (outer `hydrateApp`'s `replaceChildren` wipes inner end sentinels); no warning |
| Anchor is moved or removed by user code between mount and dispose                       | Undocumented: the handle becomes invalid. Documented: the caller owns the anchor; moving it after mount invalidates the handle                  |
| Synthesized end sentinel collides by text with an unrelated comment                     | Non-issue — the primitive walks by node identity, not textContent                                                                               |

---

## 7. Public surface & migration

### 7.1 New exports from `@llui/dom`

```ts
export { mountAtAnchor, hydrateAtAnchor } from './mount.js'
```

Types unchanged: `AppHandle`, `MountOptions` are reused.

### 7.2 Breaking change in `@llui/vike`

`pageSlot()` emits `<!-- llui-page-slot -->` instead of `<div data-llui-page-slot>`. No function rename; no deprecation cycle (pre-1.0, per CLAUDE.md "no legacy concerns"). CHANGELOG entry under `@llui/vike` flags it as breaking with migration guidance: if you were styling the slot, wrap it in your own element.

### 7.3 CHANGELOG entries

Under the next release:

- **`@llui/dom@X.Y.Z`** — **Added** `mountAtAnchor` and `hydrateAtAnchor`: mount or hydrate a component relative to a comment anchor rather than inside a container element. Uses a synthesized end sentinel to track the owned DOM region; dispose cleans up everything between the pair and removes the end sentinel, leaving the caller's anchor intact.
- **`@llui/vike@X.Y.Z`** — **Breaking** `pageSlot()` now emits `<!-- llui-page-slot -->` instead of `<div data-llui-page-slot="">`. Apps that styled or queried the div directly must wrap the slot in their own element.
- Migration block at the top of the release entry documenting the shape change and the workaround.

---

## 8. Testing strategy

TDD: every unit's test goes in red before implementation lands.

### 8.1 `packages/dom/test/mount-at-anchor.test.ts` (new)

1. Throws on detached anchor.
2. Inserts end sentinel as anchor's next sibling after mount.
3. Component nodes appear in order between the sentinel pair.
4. `dispose()` removes every node between the pair + the end sentinel, leaves the anchor.
5. `dispose()` triggers `rootScope.disposalCause === 'app-unmount'` and cascades scope disposal.
6. `send()` / `flush()` behave like `mountApp`.
7. `options.parentScope` correctly parents the instance's scope.
8. `onMount(callback)` receives `anchor.parentElement`.
9. Top-level `each()` inside the mounted component: rows appended after mount are removed on dispose (regression test for the sentinel-pair correctness claim).

### 8.2 `packages/dom/test/hydrate-at-anchor.test.ts` (new)

1. Throws on detached anchor.
2. Atomic-swap: removes server content between sentinels, inserts fresh client content.
3. Reuses the existing end sentinel when present (does not synthesize a second one).
4. Synthesizes an end sentinel when none is present (covers the vike chain's inner-layer hydration, where the outer `hydrateApp` already wiped server DOM). No warning in this path — it is routine, not an error.
5. Starts with `serverState` as initial state; original `init()` effects dispatch.
6. Dev-mode warn for stale end sentinel detection in a direct-SSR scenario where an outer wipe was not expected (caller passes an anchor whose `parentElement` was not rebuilt by `replaceChildren`).

### 8.3 `packages/vike/test/ssr-page-slot.test.ts` (new)

1. `pageSlot()` returns a `Comment` node (`nodeType === 8`).
2. Multi-layer SSR emits `<!-- llui-page-slot -->...<!-- llui-mount-end -->` bracketing inner content.
3. `data-llui-hydrate` attributes correctly identify binding sites in the composed tree.
4. Round-trip HTML parse preserves structure.

### 8.4 `packages/vike/test/client-page-slot.test.ts` (new)

1. Client hydration locates the server anchor + end sentinel, performs atomic swap.
2. Nav changes only the innermost layer: outer DOM identity preserved; only innermost region swaps.
3. Nav changes an intermediate layer: that layer + all inner dispose; new suffix mounts at the surviving anchor.
4. Dispose at layer `i` removes exactly the region between its anchor and end sentinel.

### 8.5 `packages/dom/test/hmr-anchor.test.ts` (new)

1. Hot-swap an anchor-mounted instance: region between sentinels wiped, fresh nodes inserted in the same spot.
2. Multiple anchor-mounted instances registered; hot-swap targets only the matching one by component name.
3. Dispose on an anchor-mounted instance unregisters from HMR.

### 8.6 Regression

Existing `packages/vike/test/layout.test.ts`, `widening.test.ts`, `surviving-layer-updates.test.ts` must be updated to reflect the comment-based slot shape (any assertion on `div[data-llui-page-slot]` becomes an assertion on a `Comment` node with `nodeValue === 'llui-page-slot'`). Semantics should otherwise pass unchanged.

The full `packages/dom/test/` suite must pass without change.

---

## 9. Out of scope for this design

- **True DOM-reuse hydration** (walking server DOM and binding in place). Proposed separately in `docs/proposals/true-dom-reuse-hydration.md`. Does not affect the anchor primitive's public API.
- **Richer `onMount` contract** (passing an owned-range descriptor instead of a single element). The existing `(el: Element) => ...` signature is preserved; the semantic for anchor-mounts is "parent element of the anchor". A broader `onMount` redesign is orthogonal to this change.
- **Multi-sentinel named slots** (e.g., a component exposing multiple named mount points via distinct anchor comments). Out of scope; each `mountAtAnchor` call is for a single mount site.
- **CSS-side migration tooling** for apps that styled `[data-llui-page-slot]`. Authors migrate manually.
