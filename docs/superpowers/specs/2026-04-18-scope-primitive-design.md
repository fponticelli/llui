# `scope()` structural primitive for `@llui/dom` + `Lifetime` rename

**Date:** 2026-04-18
**Status:** Design approved; pending implementation plan
**Scope:** New `@llui/dom` primitive `scope({ on, render })`. Extension of `branch` with a required-or-disallowed-by-exhaustiveness `default` case. New `h.sample(selector)` method on the View bag. Rename of the internal `Scope` disposal-lifetime concept to `Lifetime` throughout the runtime. Compiler integration in `@llui/vite-plugin`. Breaking pre-v1 type changes to `branch`.

---

## 1. Motivation

`@llui/dom`'s structural primitives express most reactive-tree shapes cleanly: `each` for lists, `branch` for enumerated variants, `show` for binary conditions, `memo` for cached derivations. Two patterns in practice don't map to any of them.

**Pattern A — rebuild a subtree when a derived key changes.** A chart component takes a stats object; the parent bumps an `epoch` counter whenever the bucket size changes so the chart should rebuild from scratch. There is no enumeration of cases; the key is dynamic. Today's workaround (from the dicerun2 post-mortem):

```ts
let currentChartSnap: { stats; mode; bucketSize; overlays } | null = null

each({
  items: (s) => {
    currentChartSnap = { stats: s.stats, mode: s.mode /* ... */ }
    return [s.statsEpoch]
  },
  key: (n) => n,
  render: () => chartView(currentChartSnap!.stats /* ... */),
})
```

`each` over a singleton array, keyed on the epoch, with a module-scope `let` as a side-channel so `render()` can read the stats snapshot. The `items` callback's primary job is the side effect, not producing the list. This is the symptom of a missing primitive.

**Pattern B — imperatively read current state inside a builder.** The `render` callback above needs the _current_ `stats` object, not a reactive binding on `s.stats`. LLui's View bag exposes `text`, `each`, `branch`, `send`, etc. — all reactive accessors. There is no one-shot "read state now" escape hatch, so callers invent closure-captured snapshots.

This design addresses both:

1. `scope({ on, render })` — new primitive that rebuilds its subtree when `on(state)` changes. Sugar over an extended `branch` with a dynamic `default` case.
2. `h.sample(selector)` — new View-bag method that reads current state at call time without creating a binding. Available in every builder (branch, show, each, scope, top-level view).
3. `branch` extended with a `default?: builder` case, typed so it's _required_ when `cases` isn't exhaustive for the key union and _disallowed_ when it is.

The third change also turns `branch` into the canonical structural primitive for keyed rebuilds — enumerated, dynamic, or hybrid — with `scope` as a named-for-intent shortcut for the dynamic-only shape (mirroring how `show` is a named shortcut for the binary-case shape).

---

## 2. High-level architecture

### 2.1 Relationship between `branch`, `show`, and `scope`

After this design:

```
branch({ on, cases, default? })  ← canonical structural primitive
│
├─ show({ when, render, fallback? })  ← sugar, 2 cases (true/false)
└─ scope({ on, render })              ← sugar, 0 cases + default
```

All three share one reconcile machinery: `branch.ts`'s existing Phase 1 hook that compares old and new keys, creates a fresh `Lifetime` for the new arm, runs the builder, disposes the old arm. `show` and `scope` construct branch options and delegate.

### 2.2 `Lifetime` rename

The internal `Scope` type — the disposal-lifetime node used by the runtime's scope tree — is renamed to `Lifetime`. The old name conflicts with the lexical-scope meaning of "scope" in programming; the renaming removes the collision with the new user-facing `scope()` primitive and names the concept more accurately.

The rename is purely internal-vocabulary: runtime behavior, DOM output, and public non-type API surface are unaffected. One public type (`ScopeNode`) and one public option field (`MountOptions.parentScope`) rename. Pre-v1, accepted.

### 2.3 `sample` addition

A new one-shot state read that returns `selector(currentState)` without creating a binding. Exposed in two places, same function underneath:

1. **Top-level import** — `import { sample } from '@llui/dom'`. Usable anywhere a render context is live: top-level `view`, `branch.cases[k]`, `show.render`, `each.render`, `scope.render`, `child.view`. Mirrors how `text`, `branch`, `each`, etc. are already top-level imports.
2. **`View<S, M>` bag method** — `h.sample(…)` for destructure-from-`h` ergonomics. Pointer-identical to the top-level function. Present in every builder that receives a `View<S, M>` bag (top-level `view`, `branch.cases[k]`, `show.render`, `scope.render`). Not on `each.render`'s bag because `each.render` receives an each-specific bag (`{ send, item, acc, index, entry? }`), not a View bag — each-render callers use the top-level import.

Calling `sample` outside a render context throws.

---

## 3. API

### 3.1 `scope`

```ts
// packages/dom/src/types.ts
export interface ScopeOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string
  render: (h: View<S, M>) => Node[]
}

// packages/dom/src/primitives/scope.ts
export function scope<S, M = unknown>(opts: ScopeOptions<S, M>): Node[]
```

Contract:

- On initial mount, `on(state)` is computed, a fresh `Lifetime` is created, `render(h)` is invoked in a render context parented at the new lifetime, and the returned nodes are inserted between a `<!-- scope -->` anchor and the surrounding children (same placement pattern as `branch`).
- On every Phase 1 reconcile tick where the scope's `__mask` overlaps the dirty mask, `on(state)` is recomputed. If `Object.is(newKey, currentKey)` is false, the current arm's lifetime is disposed, a new lifetime is created, `render(h)` runs, new nodes are inserted between the anchor and the end of the region. `enter`/`leave` transitions fire as with `branch`.
- If `__mask & dirty === 0`, reconcile is skipped — the key cannot have changed based on what's dirty.
- `render(h)` receives a `View<S, M>` bag identical in every respect to what `branch`'s case builders receive. Inside, `h.text(…)`, `h.each(…)`, `h.branch(…)`, `h.sample(…)`, `h.send`, etc. all behave as specified by the View contract.

### 3.2 `branch` — extended signature

```ts
// packages/dom/src/types.ts

type ExhaustiveKeys<K extends string, C> = [Exclude<K, keyof C & string>] extends [never]
  ? true
  : false

export type BranchOptions<
  S,
  M,
  K extends string,
  C extends Partial<Record<K, (h: View<S, M>) => Node[]>>,
> = TransitionOptions & {
  on: (s: S) => K
} & (ExhaustiveKeys<K, C> extends true
    ? { cases: C; default?: never }
    : { cases?: C; default: (h: View<S, M>) => Node[] }) & {
    /** @internal Set by `show()` / `scope()` sugar. */
    __disposalCause?: DisposerEvent['cause']
    /** @internal Compiler-injected. */
    __mask?: number
  }

export function branch<
  S,
  M = unknown,
  K extends string = string,
  C extends Partial<Record<K, (h: View<S, M>) => Node[]>> = {},
>(opts: BranchOptions<S, M, K, C>): Node[]
```

Breaking changes from today's `branch`:

1. **`on` return type narrows** from `string | number | boolean` to `string`. Numeric / boolean discriminants coerce at the call site: `on: s => String(s.code)` or `on: s => s.flag ? 'yes' : 'no'`.
2. **`cases` becomes optional** — when `default` alone is sufficient, omitting `cases` is legal (treated as `{}`).
3. **Exhaustiveness checking** — when `K` is a literal string union (e.g. `'idle' | 'loading' | 'done'`) and `cases` covers every member, `default` is typed `never` and passing a value fails compile. When `K` is wide (plain `string`) or `cases` is missing a member, `default` is required.

Runtime behavior:

- On reconcile, look up `opts.cases?.[newKey as K]`. If present, use it. Otherwise use `opts.default` if present. Otherwise render nothing (matches today's no-match behavior; dev-mode `console.warn` flags this case as likely a bug).

### 3.3 `show` — unchanged API

`show({ when, render, fallback? })` continues to compile to `branch({ on, cases: { true, false }, __disposalCause: 'show-hide' })`. Internally, `when`'s `boolean` return is stringified in the branch dispatch (`String(true) === 'true'`), which is fine because branch's new `on` type is `string`-only and the `on` passed from `show` wraps: `on: (s) => String(opts.when(s))`. No user-visible change.

### 3.4 `sample`

```ts
// packages/dom/src/primitives/sample.ts — new file
import { getRenderContext } from '../render-context.js'

export function sample<S, R>(selector: (s: S) => R): R {
  const ctx = getRenderContext('sample')
  return selector(ctx.state as S)
}

// packages/dom/src/view-helpers.ts — createView adds `sample` to the bag
import { sample as sampleImpl } from './primitives/sample.js'

export function createView<S, M>(send: Send<M>): View<S, M> {
  // … existing helpers
  return { send, text, show, each, branch, scope, memo, /* … */, sample: sampleImpl }
}

// packages/dom/src/index.ts — re-export
export { sample } from './primitives/sample.js'

// View<S, M> interface gains:
export interface View<S, M> {
  // … existing members
  sample: <R>(selector: (s: S) => R) => R
}
```

Contract:

- Calling `sample(selector)` (import) or `h.sample(selector)` (bag method) inside a render context returns `selector(currentState)` where `currentState` is the render context's current `state` reference.
- No binding is created, no mask is assigned, the call is a one-shot synchronous read.
- Calling `sample` outside a render context throws `[LLui] sample called outside render` — matches the error surface of other render-context-requiring helpers.
- Idempotence is the caller's responsibility: `sample` does not memoize. For expensive derivations, compose with `memo`.
- The top-level form works everywhere a render context is live — including `each.render`, whose bag intentionally does not carry View methods.

### 3.5 `Lifetime` rename — public API deltas

Two public surfaces change names:

- `MountOptions.parentScope` → `MountOptions.parentLifetime`
- `ScopeNode` (type export) → `LifetimeNode`

All other renames are internal to `@llui/dom`.

---

## 4. Runtime integration

### 4.1 `scope()` implementation

```ts
// packages/dom/src/primitives/scope.ts
import type { ScopeOptions, View } from '../types.js'
import { branch } from './branch.js'

export function scope<S, M = unknown>(opts: ScopeOptions<S, M>): Node[] {
  return branch<S, M, string, {}>({
    on: opts.on,
    cases: {},
    default: opts.render,
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
    __disposalCause: 'scope-rebuild',
    __mask: (opts as { __mask?: number }).__mask,
  })
}
```

No new reconcile code. `scope.ts` is a ~20-line sugar module sitting alongside `show.ts`.

### 4.2 `branch.ts` — incremental changes

Two surgical changes to `packages/dom/src/primitives/branch.ts`:

1. `reconcile()` — after the existing `const newBuilder = opts.cases[newCaseKey]`, fall through to `opts.default` if `newBuilder` is undefined:

   ```ts
   const newBuilder = opts.cases?.[newCaseKey] ?? opts.default
   ```

   (`opts.cases?.[…]` accommodates the now-optional `cases` field.)

2. Initial-mount builder lookup, same treatment:

   ```ts
   const builder = opts.cases?.[caseKey] ?? opts.default
   ```

3. `_kind` assignment — add `'scope'` branch:
   ```ts
   currentLifetime._kind =
     opts.__disposalCause === 'show-hide'
       ? 'show'
       : opts.__disposalCause === 'scope-rebuild'
         ? 'scope'
         : 'branch'
   ```

### 4.3 `DisposerEvent['cause']` union

Add `'scope-rebuild'` to the union in `packages/dom/src/tracking/disposer-log.ts`. Devtools MCP tools that surface disposer events (`llui_disposer_log`) pick it up automatically via type reflection.

### 4.4 `ScopeNode.kind` → `LifetimeNode.kind`

Add `'scope'` to the kind union:

```ts
kind: 'root' | 'show' | 'each' | 'branch' | 'child' | 'portal' | 'foreign' | 'scope'
```

### 4.5 `sample` wire-up

A standalone primitive module (`packages/dom/src/primitives/sample.ts`) exports the function. `createView` imports it and adds it to the View bag so destructured-from-`h` callers get the method. `@llui/dom`'s public entry re-exports `sample` so callers can `import { sample } from '@llui/dom'` directly — necessary for `each.render` and any other site that doesn't receive a full View bag.

`View<S, M>` interface export gains the `sample` field.

### 4.6 `Lifetime` rename — mechanical map

| Before                                                           | After                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `Scope` (interface)                                              | `Lifetime`                                               |
| `ScopeNode` (type export)                                        | `LifetimeNode`                                           |
| `createScope(parent)`                                            | `createLifetime(parent)`                                 |
| `disposeScope(lifetime)`                                         | `disposeLifetime(lifetime)`                              |
| `addDisposer(lifetime, fn)`                                      | `addDisposer(lifetime, fn)` (unchanged — already a verb) |
| `rootScope` (field on ComponentInstance, RenderContext)          | `rootLifetime`                                           |
| `parentScope` (option, field, arg)                               | `parentLifetime`                                         |
| `MountOptions.parentScope`                                       | `MountOptions.parentLifetime`                            |
| `childScope` / `leavingScope` / `currentScope` (local variables) | `childLifetime` / `leavingLifetime` / `currentLifetime`  |
| `packages/dom/src/scope.ts`                                      | `packages/dom/src/lifetime.ts`                           |
| `packages/dom/test/scope.test.ts`                                | `packages/dom/test/lifetime.test.ts`                     |

The `_kind` string-literal values (`'root'`, `'branch'`, `'show'`, `'each'`, `'child'`, `'portal'`, `'foreign'`, `'scope'`) describe the _primitive that owns the lifetime_, not the concept. They stay as-is.

Disposal-cause strings (`'branch-swap'`, `'each-remove'`, `'show-hide'`, `'app-unmount'`, `'child-unmount'`, new `'scope-rebuild'`) similarly stay as-is.

The rename touches ~20 source files, ~30 test files, and 4 doc files (readmes, design docs, llms-full.txt regeneration). All changes are mechanical find-and-replace with context.

---

## 5. Compiler integration

Three changes in `@llui/vite-plugin`.

### 5.1 `REACTIVE_API_NAMES` gains `'scope'`

```ts
// packages/vite-plugin/src/collect-deps.ts
const REACTIVE_API_NAMES = new Set([
  ...ELEMENT_HELPERS,
  'each',
  'branch',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
  'scope', // NEW
])
```

Effect: `scope({ on: s => s.epoch, render: h => [...] })`'s `on` callback's state-access paths are collected into the bitmask. Same machinery `branch.on` already uses.

The `render` prop's arrow has paramName `h`. The path resolver rejects chains not rooted at the arrow's paramName, so `h.text(s => s.x)` inside `render`'s body is picked up on the _inner_ arrow (paramName `s`), and stray `h.*` chains are filtered. No false positives. This behavior is identical to how `each.render` and `branch.cases[k]` are already treated.

### 5.2 `isReactiveAccessor` — `sample` identifier-callee skip

```ts
// packages/vite-plugin/src/collect-deps.ts :: isReactiveAccessor
if (ts.isIdentifier(parent.expression)) {
  if (parent.expression.text === 'item' || parent.expression.text === 'sample') {
    return false
  }
}
```

Covers two call shapes that share an identifier callee named `sample`:

- `sample(s => s.x)` — top-level import from `@llui/dom`.
- `({ sample }) => sample(s => s.x)` — destructured from the `View` bag inside a builder.

Without this skip, the arrow would be classified reactive and `s.x` would enter the bitmask — a false-positive path for an imperative read that creates no binding. Symmetric with the existing `'item'` skip for per-item selectors inside `each`.

The property-access form (`h.sample(s => s.x)`) is already skipped because `isReactiveAccessor` only returns `true` for `text` and `memo` on property-access callees.

### 5.3 Pass 2 — `__mask` injection for `scope`

The compiler's Pass 2 (`packages/vite-plugin/src/transform.ts`) injects `__mask: <number>` into every structural primitive's options object based on paths read in its discriminant. Today the injection is keyed on the primitive name (`branch`, `show`, `each`, `memo`). Add `'scope'` to that set. The path-collection and mask-computation logic is identical to what `branch` already uses: analyze `on`'s body, OR together the bitmasks of every path read, emit the literal.

The runtime `scope()` sugar forwards `__mask` from its options to the underlying `branch()` call (see §4.1). No new Pass 2 logic beyond the name allowlist.

### 5.4 Dev-only lint — scope `on` reads no state

The compiler already warns on suspect shapes (`namespace imports`, `.map()` on state, spread-in-children). Add one: if `scope.on` or `branch.on`'s bitmask is `0` after collection (the discriminant reads no state), emit:

> `scope()` at line N: `on` reads no state — the key never changes, so the subtree mounts once and never rebuilds. Is this intentional?

Low cost, high signal. Same category as existing bit-of-static-analysis diagnostics.

---

## 6. Type-level contract

### 6.1 Exhaustive `branch` — compile test

```ts
// packages/vite-plugin/test/branch-exhaustive.test.ts

type Status = 'idle' | 'loading' | 'done'

// OK — all cases covered, no default
branch<{ status: Status }, never, Status, { idle: B; loading: B; done: B }>({
  on: (s) => s.status,
  cases: {
    idle: () => [],
    loading: () => [],
    done: () => [],
  },
})

// @ts-expect-error — `default` is `never` when exhaustive
branch({
  on: (s: { status: Status }) => s.status,
  cases: { idle: () => [], loading: () => [], done: () => [] },
  default: () => [],
})

// OK — non-exhaustive, default required and present
branch({
  on: (s: { status: Status }) => s.status,
  cases: { idle: () => [] },
  default: () => [],
})

// @ts-expect-error — non-exhaustive, default missing
branch({
  on: (s: { status: Status }) => s.status,
  cases: { idle: () => [] },
})

// OK — wide `string` return, default required
branch({
  on: (s: { code: string }) => s.code,
  cases: { a: () => [], b: () => [] },
  default: () => [],
})
```

### 6.2 `scope` — compile test

```ts
// packages/dom/test/scope-types.test.ts

// OK
scope({
  on: (s: { epoch: number }) => String(s.epoch),
  render: () => [],
})

// @ts-expect-error — render is required
scope({
  on: (s: { epoch: number }) => String(s.epoch),
})

// @ts-expect-error — on must return string
scope({
  on: (s: { epoch: number }) => s.epoch,
  render: () => [],
})
```

### 6.3 `h.sample`

```ts
// packages/dom/test/view-sample-types.test.ts

scope({
  on: (s: { epoch: number; stats: { count: number } }) => String(s.epoch),
  render: (h) => {
    const stats = h.sample((s) => s.stats)
    // stats is { count: number } — typed, no binding
    return []
  },
})
```

---

## 7. Error handling

### 7.1 Propagating errors

Errors thrown from `on(state)` or `render(h)` propagate through Phase 1 reconcile unchanged. They bubble to the nearest `errorBoundary` (if one is mounted) or to the update loop's catch surface. Matches today's `branch` behavior — no new error-handling code.

### 7.2 `h.sample` outside render

`getRenderContext('sample')` throws `[LLui] sample called outside render`. Not reachable from correctly-written code — this is a development-time guard for callers who store `h.sample` in a closure and invoke it after the render pass completed.

### 7.3 Non-matching key, no default

When `cases[key]` is undefined and `default` is also undefined, the reconcile arm renders nothing. Matches today's branch behavior. A dev-mode `console.warn` fires once per miss with the key value and source location, helping authors notice silent-no-match bugs that TS can't catch (wide-key, non-exhaustive cases without a default — which the new typing should prevent anyway, but the runtime warning catches any gap).

### 7.4 `__mask === 0` on `on`

Compiler-level lint (see §5.4). Runtime behavior: reconcile runs on the first dirty tick (the arm mounts), then never again. Not a runtime error — may be intentional in rare cases (e.g., `on: () => 'once'` to build a static tree inside a scope lifetime for testing).

---

## 8. Testing strategy

New test files, written TDD-first per CLAUDE.md's dev-approach conventions:

- **`packages/dom/test/scope.test.ts`** — initial mount, rebuild on key change (shape-preserving + shape-changing), nested scope, disposal cascade when outer unmounts, transition hooks (`enter` / `leave`) fire correctly per rebuild, `onMount` fires on initial mount and on every rebuild.
- **`packages/dom/test/view-sample.test.ts`** — `h.sample` inside each primitive builder (branch, show, each, scope, top-level view); throws outside render; returns a fresh value on each call; accepts a selector that returns any type; composes correctly with `memo`.
- **`packages/dom/test/branch-default.test.ts`** — new `default` behavior: fires when no case matches, doesn't fire when a case matches, disposal-cause string is `'branch-swap'` (unchanged), `cases` optional.
- **`packages/dom/test/scope-types.test.ts`** — type-level: `scope({ on, render })` compiles, missing `render` errors, non-string `on` return errors.
- **`packages/vite-plugin/test/branch-exhaustive.test.ts`** — type-level: exhaustive cases without default compiles, non-exhaustive without default errors, exhaustive with default errors (via `@ts-expect-error` + `vitest` type-check pass).
- **`packages/vite-plugin/test/scope-compiler.test.ts`** — `on` paths collected into the bitmask, `render` paths rooted at `h` ignored, `sample` skipped in both property-access and identifier-callee forms, `__mask` literal emitted into the compiled output.
- **`packages/dom/test/scope-integration.test.ts`** — end-to-end: reproduce the dicerun2 epoch-rebuild pattern (a scope keyed on an epoch rebuilds a chart subtree; assert DOM is replaced; inner bindings are fresh; no binding leak across rebuilds; `h.sample` inside the render call returns the current stats snapshot).

Existing test updates (mechanical per `Lifetime` rename):

- All tests in `packages/dom/test/` referencing `Scope`, `createScope`, `disposeScope`, `parentScope`, `rootScope`, `ScopeNode` get renamed alongside the source. ~30 files touched by search-and-replace; no behavioral changes expected.
- `packages/dom/test/branch.test.ts` gains coverage for `default` (currently absent).

Integration verification: `pnpm turbo check test` must pass across the whole monorepo before the change lands. The `@llui/vike` package re-renders its SSR output against the existing fixture; the `@llui/mcp` package's devtools tests must continue to surface the new `'scope-rebuild'` disposal cause correctly.

---

## 9. Documentation deltas

- **`docs/designs/01 Architecture.md`** — add `scope` to the expressibility catalogue; note `Lifetime` as the internal disposal-tree concept.
- **`docs/designs/03 Runtime DOM.md`** — replace all `Scope` references with `Lifetime`; add `scope` to the structural-block taxonomy.
- **`docs/designs/09 API Reference.md`** — new `scope()` entry; updated `branch()` signature; new `h.sample` entry on the View bag; renamed `LifetimeNode` / `parentLifetime` references.
- **`packages/dom/README.md`** — `scope` in the primitive catalog.
- **`site/content/api/dom.md`** — `scope`, `h.sample`, `Lifetime` rename.
- **`site/content/cookbook.md`** — new recipe: "Rebuild a subtree when a derived value changes" using `scope`. Explicitly deprecates the `each + epoch + closure-sample` workaround with a code sample.

Auto-regenerated: `site/public/llms.txt`, `site/public/llms-full.txt` via `site/src/generate-llms.ts`.

---

## 10. Out of scope

- **Deep equality on `on`'s key.** `Object.is` is what `branch` already uses — changing this is a separate design.
- **Per-arm memoization.** If `on(s) === currentKey`, the arm doesn't rebuild. No sub-key memoization inside the arm beyond the normal binding-level reactivity.
- **Async `render`.** Consistent with all other structural primitives; `render` is synchronous and returns `Node[]`. `lazy()` covers async subtree loading.
- **Nested `scope` fast path.** A scope inside a scope whose outer key changes disposes the inner along with its arm. No optimization for "outer rebuilt with same inner key"; the inner rebuilds. Can be revisited if profiling shows it matters.
- **Extending `each.render`'s bag with `sample`.** `each.render` receives an each-specific bag, not a View bag. Inside each-render, `sample` is reached via the top-level import (`import { sample } from '@llui/dom'`), not via the bag. If ergonomic parity with the View-bag destructure form is wanted later (`({ item, send, sample })`), that's a separate surface change to `EachOptions.render`'s parameter shape.
- **Runtime debugger integration for `scope-rebuild`.** The MCP `llui_disposer_log` tool already surfaces any string in the cause union; no new tool surface.

---

## 11. Migration checklist for existing LLui code

Anything beyond these is out of scope for the scope-primitive landing:

1. Every `branch({ on, cases })` where `cases` doesn't cover `on`'s return type adds a `default`. Before: `branch<S, M>({ on: s => s.status, cases: { idle: … } })` with non-exhaustive `status` compiled silently; after: fails compile.
2. Every `branch({ on: s => s.numericField, … })` narrows or coerces: `on: s => String(s.numericField)`.
3. Any consumer of `MountOptions.parentScope` renames to `parentLifetime`. Grep-level check inside `@llui/vike` confirms this is the only public consumer.
4. Any type reference to `ScopeNode` renames to `LifetimeNode`. Only one consumer in `@llui/mcp` today; trivial rename.

Internal (`@llui/dom`) consumers of `createScope` / `disposeScope` / `rootScope` / `parentScope` rename along with the implementation — no separate migration because the implementation and its consumers ship in one commit.

---

## 12. Rollout

One commit containing: the `Lifetime` rename + `scope` primitive + `branch` extension + `h.sample` + compiler updates + tests + docs. The change is atomic — splitting it leaves the type surface inconsistent at intermediate commits (e.g., `branch` typed exhaustively without `scope` means callers have no dynamic-rebuild escape hatch; renaming `Scope` without `scope` leaves an ugly transient state).

No feature flag, no gradual rollout. Pre-v1 — land it and publish.
