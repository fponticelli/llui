---
name: llui-add-structural-primitive
description: >-
  Follow this exact procedure when adding a NEW structural primitive to the LLui
  runtime (@llui/dom) — a scope-owning, region-reconciling helper in the family of
  show/branch/each/virtualEach/lazy/portal/foreign/unsafeHtml. Use it whenever you're
  working inside packages/dom and creating a primitive that builds live nodes lazily,
  owns a child scope, reconciles a region between anchors, or swaps arms/rows. This is
  framework-internals work (NOT app code and NOT a @llui/components component); the
  sequence is easy to get subtly wrong — miss the context snapshot, the draining/insert
  order, the teardown, or an export and you ship a leak or a stale-UI bug. Load it
  before writing the primitive, not after.
---

# Adding a structural primitive to `@llui/dom`

A structural primitive is a **lazy `Mountable` + eager builder** pair that owns a
child scope and reconciles the DOM region between its anchors. Copy the closest
existing one: `packages/dom/src/signals/lazy.ts` (simplest, single anchor region),
`show-branch.ts` (arm-swapping via `ArmController`), or `each.ts` (keyed rows).

**Read `CLAUDE.md`'s "Invariants & landmines" first** — this primitive must uphold
all of the runtime invariants there.

## The pattern

```ts
// public factory — builds NOTHING at construction
export function signalX(...args): Mountable {
  return mountable(() => buildSignalX(...args))
}
// buildSignalX runs AT PLACEMENT, under a live build ctx
function buildSignalX(...args): Node {
  const c = requireCtx() // throws outside a build
  const doc = c.doc
  // ...anchors, spec, reconcile...
}
```

## Steps

1. **Create `packages/dom/src/signals/<name>.ts`.** Import from `./build-context.js`:
   `requireCtx`, `mountable`, `materialize`, `runBuild`, `type Mountable`,
   `type BindingSpec`, `type SignalDoc`.
2. **Factory** returns `mountable(() => buildSignalX(...))` — never build eagerly.
3. **In `buildSignalX`:** `const c = requireCtx()` first, then `const doc = c.doc`.
4. **Anchors:** create comment anchors (`doc.createComment('x')` / `'/x'`), append them
   to a `DocumentFragment`, return the frag. Your primitive owns the region _between_
   the anchors — use `removeBetween` / `nodesBetween` / `detachNodes` from `dom-region.ts`.
5. **Register the reactive spec** on `c.specs`:
   ```ts
   c.specs.push({ deps: <depPaths>, produce: (s) => s, commit: (s) => reconcile(s), structural: true })
   ```
   `structural: true` is **mandatory** — it stops the enclosing `each`'s row-rebasing
   from rewriting your identity `produce`.
6. **Snapshot contexts at placement:** `const capturedContexts = c.contexts` (do this at
   build time, like `each.ts`). Rows/arms build _lazily_ after mount, by which point a
   `provide` above you has restored the parent map — the snapshot keeps its value visible.
7. **Build rows/arms** with `runBuild(doc, buildFn, c /*inherit*/, capturedContexts /*seedContexts*/, forceInRow?)`.
   Pass `inherit = c` (rows build when the module `ctx` is null) and
   `seedContexts = capturedContexts`. `forceInRow = true` only if your children are
   row-scoped (like `each`). It returns `{ nodes, specs, host, teardowns, mounts, descriptors }`.
8. **Publish each built scope** with `buildAndPublishScope(built)` (`scope-build.ts`).
   For homogeneous keyed rows, reuse a `ScopeShape` via `scopeFromSpecs(specs, sharedShape?)`.
9. **Arm-swapping primitives** (show/branch/lazy's error arm): use the shared
   **`ArmController`** (`arm-controller.ts`). Construct with
   `{ doc, buildCtx: c, contexts: c.contexts, ownerHost: c.host, inRow, parent, insertBefore, clear, transition?, ssr: c.ssr, collectRegion?, detach? }`
   and drive with `arm.switchTo(key, armFn, state)` / `arm.dispose()`. It handles
   build → insert-against-anchor → mount → child-scope registration → teardown.
10. **Insert THEN mount.** Insert the built nodes into the parent _before_ committing the
    row/arm scope — some bindings (`<option selected>`) resolve only once connected to
    their controlling parent. `each` phase 3 and `ArmController` already do this; mirror it.
11. **Register teardowns:** `c.teardowns.push(() => { /* dispose arms/rows, cancel async, remove owned between-anchor nodes */ })`.
    This runs when an OUTER scope disposes; you must remove your own nodes or an outer
    arm teardown orphans your content.
12. **SSR:** check `c.ssr`. Client-only/async primitives emit a bare anchor and return
    early under SSR (see `lazy.ts`). Transitions and the mount lifecycle are client-only.
13. **Transitions (optional):** accept a `TransitionOptions` (`../types.js`) param and
    wire `enter`/`leave`/`onTransition`; `ArmController` takes `transition`, `each`
    implements deferred-detach leave. Never run under SSR.

## Export wiring (both files)

- `packages/dom/src/signals/dom.ts`: add `export * from './<name>.js'`.
- `packages/dom/src/signals/index.ts`: add `signalX` to the "Runtime (compiler-emitted)"
  re-export block.
- **Authoring wrapper** in `packages/dom/src/signals/authoring.ts`: add a human-facing
  `export function x(...)` that adapts signal _handles_ → `{ produce, deps, componentRooted }`
  specs and delegates to `signalX` (see `lazy`/`virtualEach`/`foreign` there). Then add
  `x` to the `from './authoring.js'` re-export in `index.ts` (beside `each`/`show`/`branch`/`lazy`/`virtualEach`/`foreign`).

## Compiler awareness — usually NONE

The signal transform only lowers a **direct component view**. A new primitive called from
view-helper functions / uncompiled code runs via the **authoring wrapper only** — no
compiler change. Add a lowering target in `packages/compiler/src/signals/transform-view.ts`
(next to `signalEach`/`signalShow`/`signalBranch`) _only_ if you want the transform to
emit `signalX` from a direct-view call; if you do, also add the lint-walker case in
`rules.ts` `visit()` (see `visitEach`/`visitShow`/`visitBranch`) so its render callbacks
get scope-augmented roots, and add it to the runtime-name allowlist in
`transform-component.ts`.

## Test — `packages/dom/test/signals/<name>.test.ts`

Model it on `lazy.test.ts` / `show.test.ts` / `each.test.ts` (+ `each-nested-structural`,
`provide-structural`, `structural-capture-reuse`, `structural-transitions`). Mount a
component and assert on real DOM. A good test proves:

- **Reactivity/gating** — the binding updates only when its deps change.
- **Dispose removes owned nodes** and runs teardowns (no leaked scroll-lock/focus-trap/foreign).
- **Context visibility** — a value `provide`d above the primitive is readable inside its lazily-built rows/arms.
- **Capture-and-reuse** — a `Mountable` captured in a var and placed in a toggling arm rebuilds fresh each remount.

## Invariants this primitive MUST uphold

- **Keyed row roots are stable elements** — a keyed row's top node cannot be a bare fragment / nested structural primitive; wrap it in an element (`each` throws otherwise).
- **Dispose removes owned nodes** and runs all row/arm teardowns.
- **Context visible in lazily-built arms/rows** via snapshot-at-placement + `seedContexts`.
- **Dev duplicate-key guard** for keyed primitives (`import.meta.env?.DEV` throws on a dup key).
- **Structural spec** sets `structural: true` with an identity `produce`.
- The `draining` reentrancy guard and disposed-drain rules are the runtime's, but a
  primitive that can `send()` from a bind/blur must not assume it commits synchronously
  mid-reconcile — see `CLAUDE.md`.

Finish with `pnpm --filter @llui/dom build check test`.
