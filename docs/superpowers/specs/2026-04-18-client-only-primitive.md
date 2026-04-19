# `clientOnly` primitive + future `'use client'` directive

**Date:** 2026-04-18
**Status:** Draft — pending approval
**Scope:** A structural primitive that marks a subtree as browser-only: SSR skips the render callback and emits a placeholder (optionally backed by a fallback subtree); hydration locates the placeholder and runs the real render client-side. A follow-up for a module-level `'use client'` directive is sketched at the end and deferred to its own spec — this document ships only the primitive.

---

## 1. Motivation

The DomEnv refactor (2026-04-18) fixed _where_ the DOM comes from during SSR. It didn't address _what happens when a component can't be rendered on the server at all_. Concrete cases the current framework doesn't handle cleanly:

### 1.1 Imperative libraries that touch `window` at construction

```ts
import L from 'leaflet' // throws on server — reads window/document at module init

const Map = component({
  view: () => [
    foreign({
      create: (el) => L.map(el).setView([0, 0], 13),
      update: (m, s) => m.panTo(s.center),
    }),
  ],
})
```

The crash is at `import L from 'leaflet'` — module evaluation under Node/Workers blows up before `view()` runs. `foreign()` itself knows nothing about this. The only current workarounds are:

- Dynamic import inside `foreign.create` (works, but `create` is sync so you can't `await` there — users end up with promise holes).
- Wrap the whole app in "client-only mount" bailing out of SSR entirely — defeats the purpose of SSR.
- Keep two module copies — one SSR-safe, one client — and branch in the SSR entry. Hand-maintained.

### 1.2 View subtrees that require a live DOM

```ts
view: () => [
  div({}, [
    foreign({
      create: (el) => new IntersectionObserver(...).observe(el),
    }),
  ]),
]
```

`IntersectionObserver` exists on jsdom but doesn't do anything useful — observers never fire, elements never intersect because there's no layout. Rendering the subtree server-side is wasted work at best, actively wrong at worst (if state depends on intersection state, SSR state lags).

### 1.3 Subtrees that benefit from deferred hydration

Widgets below the fold don't need to hydrate in the first interactive pass. A charts dashboard with twelve cards can cut hydration cost by 80% if only the visible cards run their render callbacks immediately.

### 1.4 Third-party components without SSR stories

A vendor component that calls `requestAnimationFrame` at construction, or reads `getComputedStyle`, or touches a singleton that expects a `window`. The user can't modify the vendor code; they need a way to say "don't run this on the server."

### 1.5 What we get today

Nothing. `onMount` runs only client-side (correct), but `view()` runs in full during SSR. If any primitive or import in the view path is SSR-hostile, the whole render crashes. The user's only out is to restructure the component or bail on SSR.

### 1.6 What we want

A way to declare: "this subtree is browser-only. During SSR, emit a placeholder (and optionally a server-rendered fallback). During hydration, discover the placeholder and mount the real subtree. During fresh client mount, render normally." Ergonomic, type-safe, participates in the bitmask reactive model so the inner render can still depend on parent state.

---

## 2. High-level architecture

### 2.1 The primitive

```ts
export function clientOnly<S, M>(opts: {
  /**
   * The browser-only render callback. NEVER invoked during SSR.
   * Runs at hydrate (replacing any fallback DOM) or at fresh
   * client mount (in place of where the fallback would have been).
   */
  render: (bag: View<S, M>) => Node[]

  /**
   * Server-rendered stand-in. When present, SSR runs this callback
   * and serializes its output into the HTML. Hydration replaces the
   * fallback DOM with the output of `render`.
   *
   * Omit to emit only an empty comment anchor — produces zero layout
   * until hydration swaps in the real content.
   */
  fallback?: (bag: View<S, M>) => Node[]

  /**
   * When to run `render` on the client. Default `'mount'` — runs
   * immediately when the component mounts or hydrates. Future values
   * (`'visible'`, `'idle'`) deferred to a follow-up spec.
   */
  when?: 'mount'
}): Node[]
```

### 2.2 Placement and constraints

`clientOnly()` is a view-primitive — only callable inside a component's `view()`. Like `branch`, `each`, `show`, it returns an array of `Node[]`. Typical usage spreads it into a parent element's children:

```ts
view: () => [
  div({ class: 'dashboard' }, [
    ...clientOnly({
      fallback: () => [div({ class: 'skeleton' })],
      render: () => [foreign({ ... })],
    }),
  ]),
]
```

The primitive does not receive `S` and `M` separately — it gets a `View<S, M>` bag through the same threading `branch.cases[k]`, `show.render`, `scope.render` use. Same ergonomics, same type inference.

### 2.3 DOM shape

**SSR output** (when `fallback` is provided):

```html
<!--llui-client-only-start-->
<div class="skeleton"></div>
<!--llui-client-only-end-->
```

**SSR output** (no `fallback`):

```html
<!--llui-client-only-start--><!--llui-client-only-end-->
```

Both anchors are comments, consistent with how `each`, `branch`, and `show` bracket their owned regions. Two anchors (not one) because hydration needs to know where the region _ends_ — otherwise wiping the fallback would require DOM walking with a class marker, which is fragile against user-provided fallback HTML.

**Fresh client mount** — no SSR involved, so no anchor pair needed. `clientOnly` behaves identically to calling `render()` inline.

### 2.4 Hydration contract

At hydrate:

1. Walk the container until a `<!--llui-client-only-start-->` comment is found.
2. Record it as the insertion anchor.
3. Scan forward until the matching `<!--llui-client-only-end-->` — everything between is fallback DOM, to be disposed.
4. Call `render(bag)` with the live `View<S, M>` threaded through the current render context.
5. Insert the rendered nodes between the anchors.
6. Remove the fallback DOM.
7. Leave the anchors in place — they double as region boundaries for future mask-triggered re-renders (if the primitive later supports dynamic reactivity; see §10).

The anchors become a structural block in the scope tree, owned by the host component's lifetime. Disposal of the host disposes the client-only subtree.

### 2.5 Why a runtime primitive and not a compile-time directive (in v1)

A `'use client'` module directive is strictly more powerful than the primitive — it elides the _module_ from the server graph, so imports can't even be reached during SSR. But it's also strictly more intrusive — it requires bundler cooperation (two graphs, per-module markers, deferred-import glue in the SSR bundle), breaks down when a module mixes shared and client-only code, and has semantics that vary by bundler (Vite, Rollup, esbuild, webpack all handle `'use client'` differently in React's ecosystem).

The primitive handles ~90% of the use cases on its own — users who need to gate a heavy import use dynamic `import()` inside `render`:

```ts
...clientOnly({
  render: () => [
    foreign({
      create: async (el) => {
        const L = await import('leaflet')
        return L.map(el).setView([0, 0], 13)
      },
      ...
    }),
  ],
})
```

This works because:

- `render` runs only on the client.
- `foreign.create` already accepts async returns (if it doesn't today, that's a trivial extension).
- The `import('leaflet')` expression is a dynamic import — Rollup emits a chunk, Workers' bundler inlines it into the client chunk only because `render` is reachable only from the client-mount path (once we mark it).

The last "because" is load-bearing and motivates §2.6.

### 2.6 SSR bundle elision

A naive implementation runs the `render` callback's body in the SSR bundle — unreachable at runtime but _reachable in the module graph_, so Rollup still includes it. That means importing `leaflet` at a module-scope above `clientOnly(...)` still crashes:

```ts
// crashes on SSR despite clientOnly wrapping the call
import L from 'leaflet'
view: () => [...clientOnly({ render: () => [foreign({ create: (el) => L.map(el) })] })]
```

`import L from 'leaflet'` is a module-init side effect; the crash is before `view()` runs.

The primitive alone can't fix this — the user must move the import inside `render`:

```ts
view: () => [
  ...clientOnly({
    render: () => {
      // Imports inside render() are lazy — reachable only from client.
      const L = globalThis.__leaflet ?? (globalThis.__leaflet = require('leaflet'))
      return [foreign({ create: (el) => L.map(el) })]
    },
  }),
]
```

Or, more cleanly, a top-level dynamic import that the compiler hoists:

```ts
// Under a future @llui/vite-plugin pass: top-level dynamic imports
// inside a clientOnly-only flow get hoisted and tree-shaken from
// the SSR bundle.
const L = await import('leaflet')
```

**Scope for this spec:** the primitive + its runtime contract. The compiler's module-graph pruning is a follow-up (see §10 and §11). The primitive ships useful today because most imperative libraries can be loaded via dynamic `import()` inside `render`, and the dynamic-import split Rollup gives us for free is enough.

---

## 3. API

### 3.1 `clientOnly(opts)` — primitive

```ts
// packages/dom/src/primitives/client-only.ts (new file)

import type { View } from '../view-helpers.js'

export interface ClientOnlyOptions<S, M> {
  render: (bag: View<S, M>) => Node[]
  fallback?: (bag: View<S, M>) => Node[]
  /** @internal reserved — only `'mount'` is valid in v1 */
  when?: 'mount'
}

export function clientOnly<S, M>(opts: ClientOnlyOptions<S, M>): Node[]
```

Exported from `@llui/dom`'s main entry next to the other structural primitives. Not a View-bag method in v1 — the primitive can be invoked by importing it alongside element helpers. Adding it to the View bag is a one-line follow-up if users prefer the destructured form.

### 3.2 Integration with `View<S, M>`

When `render` or `fallback` runs, the primitive re-invokes `createView<S, M>(send)` and passes the resulting bag so inner code reads correctly-typed `text`, `show`, `each`, `branch`, `memo`, etc. Same pattern as `scope.render`, `branch.cases[k]`, `show.render`.

### 3.3 Host environment requirements

- SSR (the `renderToString` / `renderNodes` path) serializes anchors + fallback. Never invokes `render`.
- Client mount (`mountApp` / `mountAtAnchor`) treats the call identically to inline `render()` — no anchors needed since there's no serialized DOM to reconcile with.
- Client hydrate (`hydrateApp` / `hydrateAtAnchor`) locates the anchor pair, discards fallback DOM, runs `render`, inserts the result.

### 3.4 What `clientOnly` does NOT do

- **Run on the server with a different code path.** Server-side, `render` is untouched — not called, not evaluated, not analyzed. The callback is data as far as SSR is concerned.
- **Split bundles automatically.** The SSR bundle includes `render`'s closure; whether `render`'s body is reachable for dead-code elimination depends on how the user structured their imports. The primitive doesn't tree-shake.
- **Defer hydration by default.** In v1, `when: 'mount'` is the only supported mode and the callback runs at hydrate time (or mount time client-side).
- **Serialize state into the placeholder.** The primitive participates in the host component's hydration envelope via the existing `window.__LLUI_STATE__` path — there's no separate per-primitive serialization. Inner state lives in the host component's state tree.

---

## 4. Runtime integration

### 4.1 SSR path

`packages/dom/src/ssr.ts`'s `renderNodes` threads the render context as today. When the view calls `clientOnly(opts)`:

1. Create the start comment: `ctx.dom.createComment('llui-client-only-start')`.
2. If `opts.fallback` is provided, call it with a freshly-threaded `View<S, M>` and collect nodes.
3. Create the end comment: `ctx.dom.createComment('llui-client-only-end')`.
4. Return `[start, ...fallbackNodes, end]`.

`serializeNodes` handles the comments verbatim — they're already supported for `each`/`branch`/`show` anchors.

The `render` callback is never invoked during SSR. It's referenced in the closure passed to the primitive but not called — so if its body touches `window`, SSR is fine.

### 4.2 Fresh client mount path

`packages/dom/src/mount.ts`'s `mountApp` / `mountAtAnchor` never see SSR HTML — the primitive short-circuits:

- No fallback rendering.
- No anchor pair.
- `render(bag)` runs inline, result is returned as-is.

Behavior is indistinguishable from `...render(bag)` at the call site. This keeps first-paint client renders as fast as possible and avoids hydration scaffolding when none is needed.

### 4.3 Client hydrate path

`packages/dom/src/primitives/client-only.ts` needs a hydrate-aware variant. The primitive, when called during a hydrate pass:

1. Pop the next pair of `<!--llui-client-only-start-->` / `<!--llui-client-only-end-->` anchors from the hydration cursor (analogous to how `each` pops its start/end anchors today).
2. Call `render(bag)` — returns fresh nodes.
3. Between the anchors, DOM-reconcile: replace the fallback DOM with the rendered DOM. Reuse nothing — the fallback was cosmetic, the client render is authoritative.
4. Leave the anchors in place.

The reconcile is simpler than `each`'s keyed pass — there's no per-node identity to preserve. One-pass "remove old, insert new."

### 4.4 RenderContext — no changes

No new fields on `RenderContext`. The primitive reads `ctx.dom`, `ctx.rootLifetime`, and `ctx.state` through the existing API.

### 4.5 Scope and lifetime

The client-only region gets its own lifetime (`createLifetime(ctx.rootLifetime)`). Disposal of the host disposes the region. The region's lifetime owns any bindings created by `render` — which means updates driven by parent state (via `text((s) => ...)` or `branch({ on: (s) => ..., cases })` inside `render`) go through the normal Phase 2 binding scan.

### 4.6 `foreign()` compatibility

`foreign.create` runs at mount/hydrate of the `foreign` primitive itself — which, when wrapped by `clientOnly`, only happens client-side. The combination is the main intended use case: `clientOnly({ render: () => [foreign({ create: (el) => new Leaflet(el) })] })`.

`foreign`'s `create` is currently sync (returns the imperative handle). Deferring to a follow-up: make it accept a `Promise<Handle>` so `render` can `await import('leaflet')` inline. Already on the roadmap independently; `clientOnly` doesn't require it but unlocks more use cases with it.

---

## 5. Hydration cursor interaction

The hydrate path currently walks the container's children looking for anchors placed by SSR (`each`, `branch`, `show`). Adding `clientOnly` anchors extends the same walk:

```
<!--llui-each-start-->           — each()
  <li>item 1</li>
<!--llui-each-end-->
<!--llui-client-only-start-->    — clientOnly()
  <div class="skeleton"></div>
<!--llui-client-only-end-->
<!--llui-branch-start-->         — branch()
  ...
<!--llui-branch-end-->
```

One anchor-pair per primitive, consumed in source order. `hydrate.ts`'s cursor advances past `llui-client-only-start`, reads the fallback (to disposal), and lands on `llui-client-only-end`.

No new hydration state is introduced — the cursor protocol is already anchor-based.

---

## 6. Error handling

### 6.1 `render` throws at hydrate

If `render(bag)` throws, the primitive leaves the fallback DOM in place and logs a development-mode warning. The host component's `errorBoundary` (if present) catches the throw the same way it catches any view-body throw.

Rationale: the fallback is a semantically-meaningful stand-in; keeping it is better than wiping the region to emptiness. Users who need different behavior (e.g., "show an error state") wrap `clientOnly` in `errorBoundary`.

### 6.2 `render` is called during SSR (shouldn't happen)

Defensive check: if `typeof document === 'undefined'` and `render` is about to run, throw with a clear message. This shouldn't be reachable through normal flow — SSR code paths never call `render` — but misuse of the primitive (e.g., calling it outside a `view()`) should fail loud.

### 6.3 Anchor pair not found at hydrate

If the hydrate cursor doesn't find matching start/end anchors, log a dev-mode warning and fall through to `mountApp`-style fresh mount of the `render` output. Better than crashing; users see their widget mount correctly despite the SSR/hydrate mismatch (usually caused by a stale cache).

### 6.4 Mismatched state between fallback and render

Not LLui's concern at this primitive level. Fallback renders a snapshot of the host state at SSR time; `render` sees the same state at hydrate time (unless Vike or another adapter updated state between SSR and hydrate, in which case that adapter is responsible for carrying the delta — same as today for non-clientOnly subtrees).

---

## 7. Compiler interaction

`@llui/vite-plugin` does not need to know about `clientOnly` in v1. The primitive is a regular view-callsite, indistinguishable from `show` or `branch` at the AST level.

Optional future optimization: if the compiler can prove `render` is referenced only from a clientOnly callback (no other call sites), it can annotate the emitted code with a `@__PURE__` marker or a `/* webpackMode: "lazy" */`-style hint so bundlers elide the reachable closure from the SSR bundle. Deferred — the spec ships the primitive without compiler changes.

### 7.1 Static fallback optimization

If `fallback` returns a fully-static subtree (no bindings, no events), the compiler's existing static-subtree optimization should kick in and emit a `__cloneStaticTemplate` call. No new machinery — the primitive's caller sees the same subtree transformation rules as any other structural primitive.

---

## 8. Testing

### 8.1 `packages/dom/test/client-only.test.ts` — new

```ts
describe('clientOnly — SSR', () => {
  it('emits start/end comments and fallback DOM', () => {
    const html = renderToString(DefWithClientOnly, initialState, env)
    expect(html).toContain('<!--llui-client-only-start-->')
    expect(html).toContain('<!--llui-client-only-end-->')
    expect(html).toContain('class="skeleton"') // fallback
  })

  it('emits only anchors when fallback is omitted', () => {
    const html = renderToString(DefNoFallback, initialState, env)
    expect(html).toMatch(
      /<!--llui-client-only-start--><!--llui-client-only-end-->/,
    )
  })

  it('never invokes render during SSR', () => {
    let renderCalled = false
    const Def = component({
      view: () => [
        ...clientOnly({
          render: () => {
            renderCalled = true
            return [text('real')]
          },
          fallback: () => [text('fallback')],
        }),
      ],
    })
    renderToString(Def, undefined, env)
    expect(renderCalled).toBe(false)
  })
})

describe('clientOnly — client hydrate', () => {
  it('replaces fallback DOM with render output', async () => {
    const html = renderToString(Def, state, env)
    const container = document.createElement('div')
    container.innerHTML = html
    hydrateApp(container, Def, state)
    // After hydrate, skeleton is gone and real content is in place.
    expect(container.querySelector('.skeleton')).toBeNull()
    expect(container.querySelector('.real-widget')).not.toBeNull()
  })

  it('preserves anchor comments after hydrate for future structural updates', () => {
    ...
  })

  it('handles fallback-free anchors (no fallback DOM to dispose)', () => {
    ...
  })
})

describe('clientOnly — fresh client mount', () => {
  it('renders inline without emitting anchor comments', () => {
    const container = document.createElement('div')
    mountApp(container, Def)
    expect(container.innerHTML).not.toContain('llui-client-only-start')
    expect(container.querySelector('.real-widget')).not.toBeNull()
  })

  it('never calls fallback during fresh mount', () => {
    let fallbackCalled = false
    const Def = component({
      view: () => [
        ...clientOnly({
          render: () => [text('real')],
          fallback: () => {
            fallbackCalled = true
            return [text('fallback')]
          },
        }),
      ],
    })
    mountApp(document.createElement('div'), Def)
    expect(fallbackCalled).toBe(false)
  })
})
```

### 8.2 `clientOnly` error cases

- `render` throwing at hydrate → fallback persists, dev warning emitted.
- Anchor mismatch → dev warning, fresh mount.

### 8.3 Integration with `foreign`

Key usage — verify `clientOnly({ render: () => [foreign({ create })] })` works end-to-end: SSR skips `foreign.create`, hydrate calls it with the live element.

### 8.4 Integration with `errorBoundary`

Wrapping `clientOnly` in `errorBoundary`: render throws → boundary's fallback UI appears.

---

## 9. Error messages

The primitive's error messages should be self-explaining. Proposed text:

```
[LLui] clientOnly() can only be called inside a component's view() function.

[LLui] clientOnly() render callback threw during hydrate: <original error>
  Fallback DOM is still visible. Wrap in errorBoundary() to show a
  different error UI, or restructure the render callback to recover.

[LLui] clientOnly() anchor pair not found at hydrate. Likely causes:
  - Server HTML is stale (missing the anchors — regenerate)
  - Hydration order diverged from SSR render order (non-deterministic view?)
  Falling back to fresh mount of render().
```

---

## 10. Out of scope

- **`'use client'` module directive.** Covered in §11.
- **Deferred hydration strategies.** `when: 'visible' | 'idle' | 'visible+idle'` — a later primitive extension, orthogonal to the SSR-skip semantics.
- **Streaming / suspense-style boundaries.** The render callback returning a promise that resolves to nodes (i.e., `Promise<Node[]>`) is a separate concern — v1 requires `render` to return synchronously, mirroring every other LLui primitive.
- **Partial SSR of the render subtree.** "Render some of it server-side, leave some blank" — not supported. Either the whole subtree is client-only, or none of it. Users wanting partial hydration compose multiple `clientOnly` primitives.
- **Automatic SSR-bundle pruning.** Described in §2.6 — users gate heavy imports via dynamic `import()` inside `render`. Compiler-level SSR/client bundle split is a later project.
- **Per-primitive hydration state.** The primitive reads state from the host component's state tree. No separate serialized state. Users wanting independent state compose `child()` inside `clientOnly`.

---

## 11. Future: `'use client'` module directive

A follow-up spec will propose a module-level `'use client'` directive handled by `@llui/vite-plugin`:

```ts
// charts.ts
'use client'
import { Chart } from 'chart.js' // SSR bundle never sees this import

export const ChartWidget = component({...})
```

**Sketch (not part of this spec):**

- Plugin detects the directive as the first non-comment statement in a module.
- For SSR builds, the plugin replaces the module's exports with stub values that render a placeholder — effectively auto-wrapping every exported component in `clientOnly`.
- For client builds, the module is left alone.
- `createContext`, `component` definitions, etc. at module top level in a `'use client'` module must remain importable by the SSR graph for typing — the plugin shims them rather than removing outright.

The directive is strictly more powerful than the primitive (it handles module-init side effects, not just view-time side effects) but requires bundler cooperation and has subtle edge cases (mixed client/server modules, re-exports, circular imports). Shipping the primitive first lets us gather usage patterns before designing the directive's semantics.

Interaction with the primitive: when both exist, the directive subsumes the primitive's runtime behavior for any component exported from a `'use client'` module — the plugin auto-wraps. Users can still call `clientOnly` explicitly within a non-`'use client'` module for finer-grained boundaries.

---

## 12. Rollout

### 12.1 Single commit series, one release

- Commit 1: Add `clientOnly` primitive in `@llui/dom/src/primitives/client-only.ts`. Export from `@llui/dom`. Implement SSR + fresh-mount paths + hydrate path + tests.
- Commit 2: Documentation — update `docs/designs/01 Architecture.md` (primitive catalogue), `03 Runtime DOM.md` (hydration cursor protocol), `09 API Reference.md` (signature). Add a cookbook entry for the Leaflet/Chart.js use case.
- Commit 3: CHANGELOG entry.

Ships as a non-breaking addition. `@llui/dom` bumps a minor; dependent packages rebuild against the new version.

### 12.2 Follow-ups

- `foreign.create` accepting `Promise<Handle>` — independent spec; removes the "sync-only imperative constructor" constraint that today forces `new Leaflet()` inline.
- `when: 'visible' | 'idle'` — deferred-hydration extension. Uses `IntersectionObserver` / `requestIdleCallback`. Non-breaking.
- `'use client'` directive — §11. Separate spec.
- View-bag method `bag.clientOnly` — ergonomic sugar. One-line change, ships when users ask for it.

### 12.3 No feature flag

The primitive is opt-in — users who don't call `clientOnly()` see no behavior change. No flag needed.

---

## 13. Open questions

Items the implementer should flag during code review if the reasoning above turns out to be wrong:

1. **Anchor naming.** `llui-client-only-start` / `-end` is a mouthful but unambiguous. Alternatives: `llui-co-*`, `llui-client-*`, shorter. Readability vs. collision-safety tradeoff.
2. **Fallback with bindings.** What if `fallback` uses `text((s) => ...)` or `show({ when: ... })`? The fallback is server-rendered — it produces HTML based on the SSR-time state snapshot. No client-side reactivity on the fallback (it's immediately disposed). This is probably fine — users who want reactive fallbacks are usually reaching for a different primitive — but worth noting.
3. **Interaction with `portal`.** `portal({ target, render: () => [...clientOnly(...)] })` — the portal rendering happens into a different DOM subtree. The anchor pair is emitted wherever the portal lands. Probably works without changes but needs a test.
4. **Interaction with `each`.** `each({ render: () => [...clientOnly(...)] })` — each item could have its own client-only region. Tests needed to confirm the hydration cursor handles per-item anchor pairs correctly (it should; this is the same shape as nested branches today).
