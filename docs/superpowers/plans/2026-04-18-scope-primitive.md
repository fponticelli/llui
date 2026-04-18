# `scope()` primitive + `Lifetime` rename implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scope({ on, render })` structural primitive to `@llui/dom` for keyed subtree rebuild, extend `branch` with a default case and exhaustiveness typing, add `sample()` for imperative state reads, and rename the internal `Scope` disposal-lifetime concept to `Lifetime`.

**Architecture:** `scope` is sugar over an extended `branch({ on, cases: {}, default: render, __disposalCause: 'scope-rebuild' })`. `sample` is a new top-level primitive mirrored on the `View` bag. `Lifetime` rename is a mechanical find-and-replace across ~39 files (internal + one public type export + one public option field). Compiler updates route through the existing shared path scanner.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces + Turborepo, TypeScript Compiler API (vite-plugin).

**Spec:** `docs/superpowers/specs/2026-04-18-scope-primitive-design.md`.

---

## File structure

**New files**
- `packages/dom/src/lifetime.ts` (renamed from `scope.ts`)
- `packages/dom/src/primitives/sample.ts`
- `packages/dom/src/primitives/scope.ts`
- `packages/dom/test/lifetime.test.ts` (renamed from `scope.test.ts`)
- `packages/dom/test/view-sample.test.ts`
- `packages/dom/test/scope.test.ts` (new — now tests the primitive, not the lifetime tree)
- `packages/dom/test/scope-integration.test.ts`
- `packages/dom/test/branch-default.test.ts`
- `packages/dom/test/branch-exhaustive-types.test.ts`
- `packages/vite-plugin/test/scope-compiler.test.ts`

**Deleted files**
- `packages/dom/src/scope.ts` (renamed to `lifetime.ts` — no actual delete; git handles the move)
- `packages/dom/test/scope.test.ts` (renamed; then a new file of the same name is created in Phase 5)

**Modified files (high-traffic)**
- `packages/dom/src/types.ts` — `Scope` → `Lifetime` interface, `ScopeNode` → `LifetimeNode`, new `ScopeOptions`, new `BranchOptions` with conditional default
- `packages/dom/src/mount.ts` — `parentScope` → `parentLifetime`, `rootScope` → `rootLifetime`
- `packages/dom/src/render-context.ts` — `rootScope` → `rootLifetime` field
- `packages/dom/src/update-loop.ts` — same
- `packages/dom/src/binding.ts` — `Scope` → `Lifetime` references
- `packages/dom/src/primitives/{branch,each,show,child,portal,foreign,error-boundary,lazy,context,selector,text,virtual-each,on-mount}.ts` — mechanical rename
- `packages/dom/src/view-helpers.ts` — `View.sample` bag method wire-up
- `packages/dom/src/index.ts` — new exports (`scope`, `sample`, `LifetimeNode`, rename `ScopeNode`)
- `packages/dom/src/tracking/disposer-log.ts` — add `'scope-rebuild'` to `DisposerEvent['cause']` union
- `packages/dom/src/devtools.ts` / `packages/mcp/src/tools/debug-api.ts` — consume renamed types
- `packages/vike/src/on-render-{client,html}.ts` — `parentScope` → `parentLifetime` consumers
- `packages/vite-plugin/src/collect-deps.ts` — `REACTIVE_API_NAMES` adds `'scope'`, `isReactiveAccessor` skips `'sample'` identifier callee
- `packages/vite-plugin/src/transform.ts` — Pass 2 mask injection allowlist adds `'scope'`
- `packages/vite-plugin/src/diagnostics.ts` — new lint for `__mask === 0` on scope/branch `on`
- `packages/dom/test/*.test.ts` — mechanical rename of Scope-related identifiers
- `docs/designs/01 Architecture.md`, `docs/designs/03 Runtime DOM.md`, `docs/designs/09 API Reference.md` — new API docs
- `packages/dom/README.md` — primitive catalog
- `site/content/api/dom.md`, `site/content/cookbook.md` — new entries
- `site/src/generate-llms.ts` (regenerates `site/public/llms-full.txt`, `llms.txt`)

**Test inventory** (renamed as part of Phase 1 mechanical rename, listed here for visibility)
- `packages/dom/test/{mount-at-anchor,optimizations,el-split-strings,hmr,devtools,phase2,binding,scope}.test.ts` all reference `Scope`-family identifiers.

---

## Phase 0 — Setup

### Task 0.1: Create a worktree for the change

**Files:** none (git state only)

- [ ] **Step 1: Create worktree from main**

```bash
cd /Users/franco/projects/llui
git worktree add ../llui-scope-primitive -b scope-primitive
cd ../llui-scope-primitive
```

- [ ] **Step 2: Verify baseline passes**

Run: `pnpm install && pnpm turbo check test`
Expected: all 28 tasks succeed (baseline — matches `main`).

- [ ] **Step 3: Read the spec**

Open `docs/superpowers/specs/2026-04-18-scope-primitive-design.md`. Every task in this plan references a section number. Keep the spec handy.

---

## Phase 1 — Lifetime rename (foundation)

Mechanical rename. Existing tests (unchanged behavior) are the verification gate. No new tests in this phase.

### Task 1.1: Rename source file `scope.ts` → `lifetime.ts`

**Files:**
- Rename: `packages/dom/src/scope.ts` → `packages/dom/src/lifetime.ts`

- [ ] **Step 1: Rename via git**

```bash
git mv packages/dom/src/scope.ts packages/dom/src/lifetime.ts
```

- [ ] **Step 2: Update exports inside the renamed file**

Inside `packages/dom/src/lifetime.ts`:
- Rename the exported interface `Scope` → `Lifetime` (if it's re-exported from this file; otherwise just rename the function symbols below).
- `createScope` → `createLifetime`
- `disposeScope` → `disposeLifetime`
- Keep `addDisposer` unchanged (verb on a Lifetime, reads fine).

- [ ] **Step 3: Do not run tests yet** — imports across the codebase still reference the old names. Next tasks fix them.

### Task 1.2: Rename `Scope` interface + `ScopeNode` type in `types.ts`

**Files:**
- Modify: `packages/dom/src/types.ts`

- [ ] **Step 1: Find the `Scope` interface definition**

```bash
grep -n "^export interface Scope\b\|^interface Scope\b" packages/dom/src/types.ts
```

- [ ] **Step 2: Rename the interface**

`export interface Scope { … }` → `export interface Lifetime { … }`

If there's an internal `ScopeNode` type in the same file:
`export interface ScopeNode { … }` → `export interface LifetimeNode { … }`

Update the `kind` field's union values to stay `'root' | 'show' | 'each' | 'branch' | 'child' | 'portal' | 'foreign'` for now — we add `'scope'` in Phase 5.

### Task 1.3: Rename every `Scope` / `createScope` / `disposeScope` / `rootScope` / `parentScope` / `ScopeNode` reference across `@llui/dom` src

**Files:** all under `packages/dom/src/` except the already-renamed `lifetime.ts` and `types.ts`.

- [ ] **Step 1: Enumerate call sites**

```bash
grep -rln "createScope\|disposeScope\|rootScope\|parentScope\|ScopeNode\|: Scope\b\|<Scope>\|Scope }\|Scope," packages/dom/src --include="*.ts" | grep -v lifetime.ts | grep -v types.ts
```

- [ ] **Step 2: Apply renames**

Use search-and-replace (one identifier at a time, in order — avoid cascading bad matches):

```
createScope       → createLifetime
disposeScope      → disposeLifetime
ScopeNode         → LifetimeNode
rootScope         → rootLifetime
parentScope       → parentLifetime
childScope        → childLifetime
leavingScope      → leavingLifetime
currentScope      → currentLifetime
: Scope\b         → : Lifetime
<Scope>           → <Lifetime>
Scope[]           → Lifetime[]
Scope,            → Lifetime,
Scope }           → Lifetime }
```

(Use your editor's multi-file replace; or `sed -i` with caution — boundary-sensitive.)

- [ ] **Step 3: Fix imports**

Every file that imported from `../scope.js` now imports from `../lifetime.js`. Grep:

```bash
grep -rln "from '.*scope\.js'\|from '.*scope'" packages/dom/src --include="*.ts"
```

Update each import path.

- [ ] **Step 4: Verify `@llui/dom` type-checks**

Run: `cd packages/dom && pnpm check`
Expected: no errors.

- [ ] **Step 5: Verify `@llui/dom` tests pass (tests still use old names — expect failures)**

Run: `pnpm test`
Expected: failures from tests still referencing `createScope`, `Scope`, etc. **That's expected** — Task 1.4 fixes them.

### Task 1.4: Rename every reference in `@llui/dom` test files

**Files:** all `packages/dom/test/*.test.ts` that match the grep in Task 1.3 Step 1 (but under `test/`).

- [ ] **Step 1: Enumerate test files**

```bash
grep -rln "createScope\|disposeScope\|rootScope\|parentScope\|ScopeNode\|: Scope\b\|<Scope>" packages/dom/test --include="*.ts"
```

- [ ] **Step 2: Apply the same rename map as Task 1.3 Step 2**

- [ ] **Step 3: Rename the test file**

```bash
git mv packages/dom/test/scope.test.ts packages/dom/test/lifetime.test.ts
```

Inside that file, update any describe/test names that said "scope" meaning the lifetime.

- [ ] **Step 4: Verify tests pass**

Run: `pnpm test`
Expected: all tests green (same behavior, new names).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(dom): rename internal Scope type to Lifetime"
```

### Task 1.5: Rename public consumers in `@llui/vike`, `@llui/test`, `@llui/components`, `@llui/mcp`

**Files:**
- `packages/vike/src/on-render-client.ts`
- `packages/vike/src/on-render-html.ts`
- `packages/test/src/test-view.ts` (check — may consume `MountOptions.parentScope`)
- `packages/components/src/utils/index.ts`
- `packages/mcp/src/tools/debug-api.ts`

- [ ] **Step 1: Enumerate**

```bash
grep -rln "parentScope\|ScopeNode\|: Scope\b\|<Scope>" packages --include="*.ts" | grep -v "/dom/" | grep -v "/dist/"
```

- [ ] **Step 2: Apply rename map across those files**

Same rename map as Task 1.3. Pay attention to imports from `@llui/dom` — the exported names are now `Lifetime` / `LifetimeNode`.

- [ ] **Step 3: Verify monorepo type-checks and tests pass**

Run: `pnpm turbo check test --force`
Expected: all 28 tasks succeed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: update @llui/{vike,test,components,mcp} for Lifetime rename"
```

---

## Phase 2 — `sample` primitive + View bag wire-up

### Task 2.1: Write failing test for top-level `sample` import

**Files:**
- Create: `packages/dom/test/view-sample.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { component, div, each, branch, show, text } from '../src'
import { sample } from '../src/primitives/sample'

describe('sample() — top-level import', () => {
  it('reads current state inside a top-level view builder', () => {
    type S = { count: number; label: string }
    let observed: number | null = null

    const Def = component<S, never, never>({
      name: 'Observer',
      init: () => [{ count: 42, label: 'x' }, []],
      update: (s) => [s, []],
      view: () => {
        observed = sample<S, number>((s) => s.count)
        return [div([text(() => '')])]
      },
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(observed).toBe(42)
  })

  it('reads current state inside an each render builder', () => {
    type S = { items: number[]; bonus: number }
    const reads: Array<{ item: number; bonus: number }> = []

    const Def = component<S, never, never>({
      name: 'EachSampler',
      init: () => [{ items: [1, 2, 3], bonus: 10 }, []],
      update: (s) => [s, []],
      view: () => [
        div(
          {},
          each<S, number>({
            items: (s) => s.items,
            key: (n) => n,
            render: ({ item }) => {
              const bonus = sample<S, number>((s) => s.bonus)
              reads.push({ item: item.current(), bonus })
              return [div([])]
            },
          }),
        ),
      ],
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(reads).toEqual([
      { item: 1, bonus: 10 },
      { item: 2, bonus: 10 },
      { item: 3, bonus: 10 },
    ])
  })

  it('throws when called outside a render context', () => {
    expect(() => sample((s: { x: number }) => s.x)).toThrow(/sample called outside render/)
  })
})

describe('h.sample — View bag method', () => {
  it('is available inside branch cases', () => {
    type S = { mode: 'a' | 'b'; payload: string }
    let captured: string | null = null

    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ mode: 'a', payload: 'hi' }, []],
      update: (s) => [s, []],
      view: ({ branch }) => [
        ...branch({
          on: (s) => s.mode,
          cases: {
            a: (h) => {
              captured = h.sample((s: S) => s.payload)
              return [div([])]
            },
            b: () => [div([])],
          },
        }),
      ],
    })

    const container = document.createElement('div')
    mountApp(container, Def).dispose()
    expect(captured).toBe('hi')
  })
})
```

- [ ] **Step 2: Run and verify fail**

```bash
cd packages/dom && pnpm vitest run test/view-sample.test.ts
```

Expected: fails — `sample` import doesn't exist yet.

### Task 2.2: Implement `sample` primitive

**Files:**
- Create: `packages/dom/src/primitives/sample.ts`
- Modify: `packages/dom/src/index.ts`

- [ ] **Step 1: Create `sample.ts`**

```ts
// packages/dom/src/primitives/sample.ts
import { getRenderContext } from '../render-context.js'

/**
 * Read current state inside a render context and return the result of
 * `selector(state)`. No binding is created, no mask is assigned — this
 * is a one-shot imperative read.
 *
 * Use when a builder needs the current state snapshot (e.g., to pass
 * an object to an imperative renderer), and a reactive binding would
 * be wrong semantically.
 *
 * Throws if called outside a render context.
 */
export function sample<S, R>(selector: (s: S) => R): R {
  const ctx = getRenderContext('sample')
  return selector(ctx.state as S)
}
```

- [ ] **Step 2: Re-export from `@llui/dom`'s main entry**

In `packages/dom/src/index.ts`, alongside the other primitive exports:

```ts
export { sample } from './primitives/sample.js'
```

- [ ] **Step 3: Run test — `each` + top-level-view cases pass, branch case still fails**

```bash
pnpm vitest run test/view-sample.test.ts
```

Expected: 3 pass, 1 fail (the `h.sample` branch case — View bag doesn't carry `sample` yet).

### Task 2.3: Add `sample` to the View bag

**Files:**
- Modify: `packages/dom/src/view-helpers.ts`
- Modify: `packages/dom/src/types.ts`

- [ ] **Step 1: Extend the `View<S, M>` interface**

In `packages/dom/src/view-helpers.ts` (or wherever `View<S, M>` is defined — check with grep):

```bash
grep -rn "export interface View\b\|export type View\b" packages/dom/src
```

Add `sample` to the interface:

```ts
export interface View<S, M> {
  // …existing members
  sample: <R>(selector: (s: S) => R) => R
}
```

- [ ] **Step 2: Wire `sample` into `createView`**

Import `sample` and include in the returned bag:

```ts
import { sample as sampleImpl } from './primitives/sample.js'

export function createView<S, M>(send: Send<M>): View<S, M> {
  // …existing local helpers
  return {
    send,
    // …existing members
    sample: sampleImpl as <R>(selector: (s: S) => R) => R,
  }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run test/view-sample.test.ts
```

Expected: all 4 pass.

- [ ] **Step 4: Run the rest of the dom suite**

```bash
pnpm test
```

Expected: all green (View interface change is additive).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dom): add sample() for imperative state reads"
```

---

## Phase 3 — `branch` runtime extension (default case)

### Task 3.1: Write failing runtime test for `default` fallback

**Files:**
- Create: `packages/dom/test/branch-default.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { branch } from '../src/primitives/branch'
import { component, div, text } from '../src'

describe('branch default case', () => {
  it('fires default when no case matches', () => {
    type S = { kind: string }
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ kind: 'unknown' }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch({
          on: (s) => s.kind,
          cases: { a: () => [div({ id: 'case-a' })], b: () => [div({ id: 'case-b' })] },
          default: () => [div({ id: 'fallback' })],
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(container.querySelector('#fallback')).not.toBeNull()
    expect(container.querySelector('#case-a')).toBeNull()
    handle.dispose()
  })

  it('does not fire default when a case matches', () => {
    type S = { kind: string }
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ kind: 'a' }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch({
          on: (s) => s.kind,
          cases: { a: () => [div({ id: 'case-a' })] },
          default: () => [div({ id: 'fallback' })],
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(container.querySelector('#case-a')).not.toBeNull()
    expect(container.querySelector('#fallback')).toBeNull()
    handle.dispose()
  })

  it('accepts optional cases — default only', () => {
    type S = { epoch: number }
    let buildCount = 0
    const Def = component<S, never, never>({
      name: 'Br',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...branch({
          on: (s) => String(s.epoch),
          default: () => {
            buildCount++
            return [div({ id: 'rebuild' })]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    expect(container.querySelector('#rebuild')).not.toBeNull()
    handle.dispose()
  })
})
```

- [ ] **Step 2: Run and verify fail**

```bash
pnpm vitest run test/branch-default.test.ts
```

Expected: all 3 fail — `default` isn't honored by `branch`, `cases` required by current type.

### Task 3.2: Implement `default` in `branch.ts` reconciler

**Files:**
- Modify: `packages/dom/src/primitives/branch.ts`

- [ ] **Step 1: Update `BranchOptions` field shape (runtime type only — full conditional typing lands in Phase 4)**

For now, relax `BranchOptions` in `packages/dom/src/types.ts` to allow both optional cases and default:

```ts
export interface BranchOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string
  cases?: Record<string, (h: View<S, M>) => Node[]>
  default?: (h: View<S, M>) => Node[]
  __disposalCause?: DisposerEvent['cause']
  __mask?: number
}
```

(Phase 4 replaces this with the exhaustive conditional type.)

- [ ] **Step 2: Patch `branch.ts` reconcile logic**

In `packages/dom/src/primitives/branch.ts`, find the two builder lookups:

```ts
// Initial mount (near bottom of branch())
const builder = opts.cases[caseKey]

// Reconcile
const newBuilder = opts.cases[newCaseKey]
```

Replace with:

```ts
const builder = opts.cases?.[caseKey] ?? opts.default

const newBuilder = opts.cases?.[newCaseKey] ?? opts.default
```

- [ ] **Step 3: Update the `on` return handling**

`opts.on(state)` now returns `string`. Remove any `String(...)` coercion on the result if present, or keep it defensive. Ensure `newCaseKey = String(newKey)` works with string input (it's a no-op for strings).

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run test/branch-default.test.ts
```

Expected: all 3 pass.

- [ ] **Step 5: Run full dom suite**

```bash
pnpm test
```

Expected: most green; some existing branch-consuming tests may fail because of the stricter `on: (s) => string` return type. Next task fixes them.

### Task 3.3: Update `show.ts` for string-only `on`

**Files:**
- Modify: `packages/dom/src/primitives/show.ts`

- [ ] **Step 1: Wrap `when` in `String(...)`**

```ts
import type { ShowOptions } from '../types.js'
import { branch } from './branch.js'

const EMPTY = () => [] as Node[]

export function show<S, M = unknown>(opts: ShowOptions<S, M>): Node[] {
  return branch<S, M>({
    on: (s) => String(opts.when(s)) as 'true' | 'false',
    cases: { true: opts.render, false: opts.fallback ?? EMPTY },
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
    __disposalCause: 'show-hide',
  })
}
```

- [ ] **Step 2: Run show tests**

```bash
pnpm vitest run test/show-sibling-order.test.ts
```

Expected: pass.

### Task 3.4: Fix any other branch-consuming tests broken by the `string`-only narrowing

**Files:** any test in `packages/dom/test/` using `branch({ on: (s) => s.numField })` or similar.

- [ ] **Step 1: Find callers**

```bash
grep -rln "branch(" packages/dom/test --include="*.ts"
grep -rln "branch(" packages/dom/src --include="*.ts"
grep -rln "branch(" packages/components/src --include="*.ts"
grep -rln "branch(" packages/router/src --include="*.ts"
```

- [ ] **Step 2: For each caller with a non-string `on`**

Wrap in `String(...)`:
```ts
// Before
branch({ on: (s) => s.count, cases: { 0: …, 1: … } })

// After
branch({ on: (s) => String(s.count), cases: { '0': …, '1': … } })
```

- [ ] **Step 3: Run full monorepo check and test**

```bash
cd /Users/franco/projects/llui
pnpm turbo check test --force
```

Expected: all 28 tasks green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(dom): branch() accepts default case for non-matching keys"
```

---

## Phase 4 — `branch` exhaustiveness typing

### Task 4.1: Write type test with `@ts-expect-error` markers

**Files:**
- Create: `packages/dom/test/branch-exhaustive-types.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it } from 'vitest'
import { branch } from '../src/primitives/branch'
import type { View } from '../src/view-helpers'

type Status = 'idle' | 'loading' | 'done'
type S = { status: Status }
type B = (h: View<S, never>) => Node[]

const b: B = () => []

describe('branch exhaustiveness typing', () => {
  it('compiles: all cases covered, no default', () => {
    branch<S, never, Status>({
      on: (s) => s.status,
      cases: { idle: b, loading: b, done: b },
    })
  })

  it('rejects default when cases are exhaustive', () => {
    branch<S, never, Status>({
      on: (s) => s.status,
      cases: { idle: b, loading: b, done: b },
      // @ts-expect-error — default is `never` when exhaustive
      default: b,
    })
  })

  it('compiles: non-exhaustive with default', () => {
    branch<S, never, Status>({
      on: (s) => s.status,
      cases: { idle: b },
      default: b,
    })
  })

  it('rejects non-exhaustive without default', () => {
    branch<S, never, Status>({
      // @ts-expect-error — default required when cases non-exhaustive
      on: (s) => s.status,
      cases: { idle: b },
    })
  })

  it('compiles: wide string on, cases + default', () => {
    branch<{ code: string }, never, string>({
      on: (s) => s.code,
      cases: { a: b, b: b },
      default: b,
    })
  })

  it('rejects wide string on without default', () => {
    branch<{ code: string }, never, string>({
      // @ts-expect-error — wide string is never exhaustive
      on: (s) => s.code,
      cases: { a: b },
    })
  })
})
```

- [ ] **Step 2: Run type-check — should succeed (tests only validate compile)**

```bash
pnpm check
```

Expected: passes **with the wrong typing**, because current `BranchOptions` doesn't enforce exhaustiveness. The `@ts-expect-error` markers will be inactive. Note: `@ts-expect-error` at an inactive location causes a TS error, so the test will fail compile (ironic-but-helpful).

### Task 4.2: Implement exhaustiveness typing in `BranchOptions`

**Files:**
- Modify: `packages/dom/src/types.ts`
- Modify: `packages/dom/src/primitives/branch.ts`

- [ ] **Step 1: Replace `BranchOptions` with the conditional type**

In `packages/dom/src/types.ts`:

```ts
type ExhaustiveKeys<K extends string, C> =
  [Exclude<K, keyof C & string>] extends [never] ? true : false

export type BranchOptions<
  S,
  M = unknown,
  K extends string = string,
  C extends Partial<Record<K, (h: View<S, M>) => Node[]>> = {},
> = TransitionOptions & {
  on: (s: S) => K
} & (
  ExhaustiveKeys<K, C> extends true
    ? { cases: C; default?: never }
    : { cases?: C; default: (h: View<S, M>) => Node[] }
) & {
  /** @internal Set by show()/scope() sugar. */
  __disposalCause?: DisposerEvent['cause']
  /** @internal Compiler-injected. */
  __mask?: number
}
```

- [ ] **Step 2: Update `branch()` signature**

In `packages/dom/src/primitives/branch.ts`, change the function signature:

```ts
export function branch<
  S,
  M = unknown,
  K extends string = string,
  C extends Partial<Record<K, (h: View<S, M>) => Node[]>> = {},
>(opts: BranchOptions<S, M, K, C>): Node[] {
  // existing body, with `opts.cases?.[…] ?? opts.default` from Phase 3
}
```

- [ ] **Step 3: Run type test**

```bash
pnpm vitest run test/branch-exhaustive-types.test.ts
```

Expected: passes (the `@ts-expect-error` markers now correctly fire).

- [ ] **Step 4: Run full monorepo check**

```bash
cd /Users/franco/projects/llui
pnpm turbo check test --force
```

Expected: all green. `show`'s internal `branch()` call already uses the generic parameters correctly (from Phase 3).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(dom): exhaustiveness typing for branch() cases/default"
```

---

## Phase 5 — `scope()` primitive + disposer cause + LifetimeNode kind

### Task 5.1: Add `'scope-rebuild'` to the disposer-cause union

**Files:**
- Modify: `packages/dom/src/tracking/disposer-log.ts`

- [ ] **Step 1: Find the union**

```bash
grep -n "cause:" packages/dom/src/tracking/disposer-log.ts
```

- [ ] **Step 2: Add the new variant**

```ts
export interface DisposerEvent {
  // existing fields
  cause: 'app-unmount' | 'branch-swap' | 'show-hide' | 'each-remove' | 'child-unmount' | 'scope-rebuild'
}
```

- [ ] **Step 3: Verify type-check**

```bash
pnpm check
```

### Task 5.2: Add `'scope'` to `LifetimeNode.kind`

**Files:**
- Modify: `packages/dom/src/types.ts`

- [ ] **Step 1: Extend the kind union**

```ts
export interface LifetimeNode {
  // existing fields
  kind: 'root' | 'show' | 'each' | 'branch' | 'child' | 'portal' | 'foreign' | 'scope'
}
```

### Task 5.3: Extend `branch.ts` to tag lifetime with `'scope'` kind

**Files:**
- Modify: `packages/dom/src/primitives/branch.ts`

- [ ] **Step 1: Update `_kind` assignment**

Replace the existing `_kind` ternary:

```ts
currentLifetime._kind =
  opts.__disposalCause === 'show-hide' ? 'show' :
  opts.__disposalCause === 'scope-rebuild' ? 'scope' :
  'branch'
```

Also the disposal tag on the leaving arm:

```ts
leavingLifetime.disposalCause = opts.__disposalCause ?? 'branch-swap'
```

(This line already exists — just confirm it picks up the new `'scope-rebuild'` value.)

### Task 5.4: Define `ScopeOptions` and the `scope()` function

**Files:**
- Modify: `packages/dom/src/types.ts`
- Create: `packages/dom/src/primitives/scope.ts`
- Modify: `packages/dom/src/index.ts`

- [ ] **Step 1: Add `ScopeOptions` to `types.ts`**

```ts
export interface ScopeOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string
  render: (h: View<S, M>) => Node[]
}
```

- [ ] **Step 2: Create `scope.ts`**

```ts
// packages/dom/src/primitives/scope.ts
import type { ScopeOptions } from '../types.js'
import { branch } from './branch.js'

/**
 * Rebuild a subtree when `on(state)` changes. Sugar over `branch()` with
 * an empty cases record and a required default. Reacts only to changes in
 * whatever state paths `on` reads (compiler-injected mask).
 */
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

- [ ] **Step 3: Re-export from `@llui/dom`**

In `packages/dom/src/index.ts`, alongside the other primitive exports:

```ts
export { scope } from './primitives/scope.js'
export type { ScopeOptions } from './types.js'
```

### Task 5.5: Write tests for the `scope()` primitive

**Files:**
- Create: `packages/dom/test/scope.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { mountApp, flush } from '../src'
import { scope } from '../src/primitives/scope'
import { component, div, text } from '../src'

describe('scope() — keyed subtree rebuild', () => {
  it('mounts once when key never changes', () => {
    type S = { epoch: number }
    let buildCount = 0
    const Def = component<S, never, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...scope<S>({
          on: (s) => String(s.epoch),
          render: () => {
            buildCount++
            return [div({ id: 'region' })]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    handle.dispose()
  })

  it('rebuilds the subtree when the key changes', () => {
    type S = { epoch: number }
    type Msg = { type: 'bump' }
    let buildCount = 0

    const Def = component<S, Msg, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s, m) => (m.type === 'bump' ? [{ epoch: s.epoch + 1 }, []] : [s, []]),
      view: ({ send }) => [
        ...scope<S, Msg>({
          on: (s) => String(s.epoch),
          render: () => {
            buildCount++
            const el = div({ id: `region-${buildCount}` })
            return [el]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    expect(buildCount).toBe(1)
    expect(container.querySelector('#region-1')).not.toBeNull()

    handle.send({ type: 'bump' })
    flush()
    expect(buildCount).toBe(2)
    expect(container.querySelector('#region-1')).toBeNull()
    expect(container.querySelector('#region-2')).not.toBeNull()

    handle.dispose()
  })

  it('disposes the arm when the component unmounts', () => {
    type S = { epoch: number }
    let disposed = false
    const Def = component<S, never, never>({
      name: 'S',
      init: () => [{ epoch: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        ...scope<S>({
          on: (s) => String(s.epoch),
          render: ({ onMount }) => {
            onMount(() => () => {
              disposed = true
            })
            return [div()]
          },
        }),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)
    handle.dispose()
    expect(disposed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm vitest run test/scope.test.ts
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(dom): scope() primitive for keyed subtree rebuild"
```

### Task 5.6: Type-level tests for `scope()`

**Files:**
- Create: `packages/dom/test/scope-types.test.ts`

- [ ] **Step 1: Write type tests**

```ts
import { describe, it } from 'vitest'
import { scope } from '../src/primitives/scope'

describe('scope() type surface', () => {
  it('compiles: on returns string, render returns Node[]', () => {
    scope<{ epoch: number }>({
      on: (s) => String(s.epoch),
      render: () => [],
    })
  })

  it('rejects: on returning non-string', () => {
    scope<{ epoch: number }>({
      // @ts-expect-error — on must return string
      on: (s) => s.epoch,
      render: () => [],
    })
  })

  it('rejects: render missing', () => {
    // @ts-expect-error — render is required
    scope<{ epoch: number }>({
      on: (s) => String(s.epoch),
    })
  })
})
```

- [ ] **Step 2: Verify type-check passes (which means the `@ts-expect-error` markers are firing correctly)**

```bash
pnpm check
```

Expected: green. If any `@ts-expect-error` is inactive, TS flags it and compile fails.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(dom): type surface guards for scope()"
```

---

## Phase 6 — Compiler integration

### Task 6.1: Write failing compiler tests for `scope` + `sample` handling

**Files:**
- Create: `packages/vite-plugin/test/scope-compiler.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { collectStatePathsFromSource, collectDeps } from '../src/collect-deps'

function pathsOf(source: string): string[] {
  const sf = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true)
  return [...collectStatePathsFromSource(sf)].sort()
}

describe('scope() path scanning', () => {
  it('collects `on`-callback state reads', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ epoch: 0, label: '' }, []],
        update: (s) => [s, []],
        view: ({ text, scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: ({ text }) => [div([text((s) => s.label)])],
          }),
        ],
      })
    `
    const paths = pathsOf(src)
    expect(paths).toContain('epoch')
    expect(paths).toContain('label')
  })

  it('does not pollute paths from render rooted at h', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      declare const other: { junk: number }
      component({
        name: 'C',
        init: () => [{ epoch: 0 }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: (h) => [div([/* h.junk would fail TS anyway, just ensure no pollution */])],
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['epoch'])
  })

  it('does not count sample(s => s.x) as a path', () => {
    const src = `
      import { component, div, text, sample } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: () => [
          div([
            text((s) => String(s.count)),
            ...[sample((s) => s.stats)],
          ]),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })

  it('does not count destructured-from-h sample', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.count),
            render: ({ sample }) => {
              const snap = sample((s) => s.stats)
              return []
            },
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })

  it('does not count h.sample(s => s.x)', () => {
    const src = `
      import { component, div, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ count: 0, stats: {} }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.count),
            render: (h) => {
              const snap = h.sample((s) => s.stats)
              return []
            },
          }),
        ],
      })
    `
    expect(pathsOf(src)).toEqual(['count'])
  })
})

describe('scope() __mask injection (Pass 2)', () => {
  it('injects __mask with the bit(s) matching on-paths into scope() options', () => {
    const src = `
      import { component, div, text, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{ epoch: 0, other: 0 }, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: (s) => String(s.epoch),
            render: ({ text }) => [div([text((s) => String(s.other))])],
          }),
        ],
      })
    `
    // transformLlui is the existing harness used by test/transform.test.ts;
    // it returns the emitted code so we can grep for the injected __mask.
    // Path bit assignment follows insertion order: `epoch` is the first
    // reactive path encountered (on-callback), `other` is the second
    // (inner text accessor).
    const { transformLlui } = require('../src/transform') as typeof import('../src/transform')
    const out = transformLlui(src, 'test.ts')?.output ?? src
    // scope options should carry an __mask literal referencing the epoch bit.
    // The compiler emits something like: scope({ on: ..., render: ..., __mask: 1 })
    expect(out).toMatch(/scope\s*\([^)]*__mask\s*:\s*\d+/s)
  })
})
```

Leave the last describe block stubbed if the local transform-test pattern is unclear; the scanner tests above are the primary gate.

- [ ] **Step 2: Run and verify fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/scope-compiler.test.ts
```

Expected: fails — `scope` isn't in `REACTIVE_API_NAMES`, `sample` not in the skip list.

### Task 6.2: Update `REACTIVE_API_NAMES` and add `sample` to skip list

**Files:**
- Modify: `packages/vite-plugin/src/collect-deps.ts`

- [ ] **Step 1: Add `'scope'` to `REACTIVE_API_NAMES`**

```ts
const REACTIVE_API_NAMES = new Set([
  ...[/* element helpers */],
  'each',
  'branch',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
  'scope',  // NEW
])
```

- [ ] **Step 2: Extend `isReactiveAccessor` identifier skip**

```ts
if (ts.isIdentifier(parent.expression)) {
  if (parent.expression.text === 'item' || parent.expression.text === 'sample') {
    return false
  }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run test/scope-compiler.test.ts
```

Expected: all `pathsOf` tests pass.

### Task 6.3: Pass 2 — add `'scope'` to `__mask` injection allowlist

**Files:**
- Modify: `packages/vite-plugin/src/transform.ts`

- [ ] **Step 1: Find the Pass 2 mask injection site**

```bash
grep -n "'branch'\|'each'\|__mask" packages/vite-plugin/src/transform.ts | head -30
```

Look for the set/switch that decides which structural primitive calls get `__mask` injected.

- [ ] **Step 2: Add `'scope'` to that set**

Exact edit depends on current code shape — add `'scope'` alongside `'branch'`, `'show'`, `'each'`, `'memo'`. The path-collection logic is keyed on the call's first argument's `on` property, which `scope` shares.

- [ ] **Step 3: Run the full vite-plugin test suite**

```bash
pnpm test
```

Expected: all green, including existing `branch`/`each` mask-injection tests.

### Task 6.4: Dev-mode lint — `__mask === 0` on `scope.on` / `branch.on`

**Files:**
- Modify: `packages/vite-plugin/src/diagnostics.ts`

- [ ] **Step 1: Write a failing test**

Append to `packages/vite-plugin/test/diagnostics.test.ts`:

```ts
describe('scope/branch on reads no state', () => {
  it('warns when scope.on reads no state paths', () => {
    const src = `
      import { component, div, scope } from '@llui/dom'
      component({
        name: 'C',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ scope }) => [
          ...scope({
            on: () => 'static',
            render: () => [div()],
          }),
        ],
      })
    `
    const w = warnings(src)
    expect(w.some((m) => m.includes('reads no state') && m.includes('scope'))).toBe(true)
  })
})
```

Run — should fail.

- [ ] **Step 2: Implement the check**

Add a `checkEmptyMaskOn` diagnostic in `diagnostics.ts` that fires when a `scope()` or `branch()` call's `on` property yields an empty path set. Consume `collectStatePathsFromSource` (already imported) and scope the path extraction to the `on` arrow's body only.

Example shape:

```ts
function checkEmptyMaskOn(node: ts.Node, sf: ts.SourceFile, diagnostics: Diagnostic[]): void {
  if (!ts.isCallExpression(node)) return
  if (!ts.isIdentifier(node.expression)) return
  const name = node.expression.text
  if (name !== 'scope' && name !== 'branch') return

  const args = node.arguments
  if (args.length === 0 || !ts.isObjectLiteralExpression(args[0])) return

  const obj = args[0] as ts.ObjectLiteralExpression
  const onProp = obj.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'on',
  )
  if (!onProp) return
  const onValue = onProp.initializer
  if (!ts.isArrowFunction(onValue) && !ts.isFunctionExpression(onValue)) return

  // Reuse the shared scanner over the `on` subtree
  const subSf = ts.createSourceFile('sub.ts', onValue.body.getText(sf), ts.ScriptTarget.Latest, true)
  const paths = collectStatePathsFromSource(subSf)
  if (paths.size > 0) return

  const { line, column } = pos(node, sf)
  diagnostics.push({
    message: `${name}() at line ${line}: 'on' reads no state — the key never changes, so the subtree mounts once and never rebuilds. Is this intentional?`,
    line,
    column,
  })
}
```

Register in the main `diagnose()` visit function.

- [ ] **Step 3: Run the test**

```bash
pnpm vitest run test/diagnostics.test.ts
```

Expected: passes.

### Task 6.5: Commit compiler changes

- [ ] **Step 1: Run full repo check/test**

```bash
cd /Users/franco/projects/llui
pnpm turbo check test --force
```

Expected: 28 tasks green.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(vite-plugin): recognize scope() and sample() in path scanner + mask injection"
```

---

## Phase 7 — Docs + integration test

### Task 7.1: Write end-to-end integration test

**Files:**
- Create: `packages/dom/test/scope-integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { mountApp, flush } from '../src'
import { scope } from '../src/primitives/scope'
import { sample } from '../src/primitives/sample'
import { component, div, text } from '../src'

// Reproduces the dicerun2 pattern: outer state carries a stats object
// plus an epoch counter. The chart subtree reads stats via sample()
// at rebuild time, not as a reactive binding. Bumping the epoch
// rebuilds the chart; stats-only changes do NOT (mask misses).

type Stats = { samples: number; mean: number }
type S = { stats: Stats; epoch: number; live: number }
type Msg =
  | { type: 'updateStats'; stats: Stats }  // updates stats, no epoch bump
  | { type: 'rebuildChart' }               // bumps epoch
  | { type: 'tickLive' }                   // updates live counter

describe('scope() + sample() integration', () => {
  it('rebuilds chart when epoch changes; skips rebuild on stats-only change; live binding stays reactive', () => {
    let chartBuildCount = 0
    let capturedStats: Stats | null = null

    const Def = component<S, Msg, never>({
      name: 'Dashboard',
      init: () => [{ stats: { samples: 0, mean: 0 }, epoch: 0, live: 0 }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'updateStats': return [{ ...s, stats: m.stats }, []]
          case 'rebuildChart': return [{ ...s, epoch: s.epoch + 1 }, []]
          case 'tickLive': return [{ ...s, live: s.live + 1 }, []]
        }
      },
      view: ({ text }) => [
        div({}, [
          div({ id: 'live' }, [text((s) => String(s.live))]),
          ...scope<S, Msg>({
            on: (s) => String(s.epoch),
            render: () => {
              chartBuildCount++
              capturedStats = sample<S, Stats>((s) => s.stats)
              return [div({ id: `chart-${chartBuildCount}` })]
            },
          }),
        ]),
      ],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Def)

    expect(chartBuildCount).toBe(1)
    expect(capturedStats).toEqual({ samples: 0, mean: 0 })
    expect(container.querySelector('#chart-1')).not.toBeNull()
    expect(container.querySelector('#live')?.textContent).toBe('0')

    // Stats update — chart should NOT rebuild (epoch unchanged)
    handle.send({ type: 'updateStats', stats: { samples: 10, mean: 5 } })
    flush()
    expect(chartBuildCount).toBe(1)

    // Live tick — live text updates, chart unchanged
    handle.send({ type: 'tickLive' })
    flush()
    expect(container.querySelector('#live')?.textContent).toBe('1')
    expect(chartBuildCount).toBe(1)

    // Epoch bump — chart rebuilds with current stats
    handle.send({ type: 'rebuildChart' })
    flush()
    expect(chartBuildCount).toBe(2)
    expect(capturedStats).toEqual({ samples: 10, mean: 5 })
    expect(container.querySelector('#chart-1')).toBeNull()
    expect(container.querySelector('#chart-2')).not.toBeNull()

    handle.dispose()
  })
})
```

- [ ] **Step 2: Run**

```bash
cd packages/dom && pnpm vitest run test/scope-integration.test.ts
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(dom): end-to-end scope() + sample() integration"
```

### Task 7.2: Update design docs

**Files:**
- Modify: `docs/designs/01 Architecture.md`
- Modify: `docs/designs/03 Runtime DOM.md`
- Modify: `docs/designs/09 API Reference.md`
- Modify: `packages/dom/README.md`
- Modify: `site/content/api/dom.md`
- Modify: `site/content/cookbook.md`

- [ ] **Step 1: API reference** (`docs/designs/09 API Reference.md`)

Under "Structural Primitives", add:

````markdown
### `scope(opts)`

Rebuild a subtree when a derived key changes.

```typescript
function scope<S, M = unknown>(opts: {
  on: (s: S) => string
  render: (h: View<S, M>) => Node[]
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: TransitionCallback
}): Node[]
```

When `on(state)` returns a new value (compared with `Object.is`), the current arm's lifetime is disposed, `render(h)` runs against a fresh lifetime, and the new nodes replace the old ones. Transitions fire via `enter` / `leave`.

Sugar for `branch({ on, cases: {}, default: render, __disposalCause: 'scope-rebuild' })`.

See: `docs/superpowers/specs/2026-04-18-scope-primitive-design.md`

---

### `sample(selector)`

Imperative one-shot state read inside a render context.

```typescript
function sample<S, R>(selector: (s: S) => R): R
```

Returns `selector(currentState)` at call time; no binding is created. Throws when called outside a render context. Also available as `h.sample` on the View bag.

Use when a builder needs the current state snapshot (e.g. to pass an object to an imperative renderer) and a reactive binding would be wrong semantically.
````

Update the `branch(opts)` section's signature to the new exhaustiveness-typed form.

- [ ] **Step 2: Architecture doc** (`docs/designs/01 Architecture.md`)

Find the "Expressibility catalogue" section (grep for `branch` to locate). Add a row for `scope`:

```markdown
| `scope({ on, render })` | Keyed subtree rebuild — fresh lifetime + fresh bindings each time `on(state)` changes. Sugar over `branch({ cases: {}, default })`. |
```

In the same section, wherever the doc says "the scope tree" or "scope lifetime" meaning the disposal hierarchy, change "scope" to "Lifetime" (note the rename). A grep-and-human-review pass is easier than mechanical replace here — the word "scope" appears in both the old lifetime sense and generic English senses.

- [ ] **Step 3: Runtime DOM doc** (`docs/designs/03 Runtime DOM.md`)

Two passes:
1. Global find: every use of `Scope` (capitalized type name) → `Lifetime`; every `createScope` → `createLifetime`; `disposeScope` → `disposeLifetime`. Use the same rename map as Phase 1.
2. New section "Scope primitive": describe the rebuild-on-key-change flow. Note the `'scope-rebuild'` disposal cause and `_kind: 'scope'` variant on `LifetimeNode`. Reference §4 of the spec.

- [ ] **Step 4: Package README** (`packages/dom/README.md`)

Add `scope` and `sample` to the primitive catalog. Update `Lifetime` terminology.

- [ ] **Step 5: Site docs** (`site/content/api/dom.md`)

Mirror the API reference entries.

- [ ] **Step 6: Cookbook recipe** (`site/content/cookbook.md`)

Add a new section:

````markdown
## Rebuild a subtree when a derived value changes

When a piece of state bumps an epoch / version counter and you want the downstream subtree to rebuild from scratch — not diff in place — use `scope()`:

```ts
scope({
  on: (s) => String(s.chartEpoch),
  render: () => {
    const stats = sample<State, Stats>((s) => s.stats)
    return [chartView(stats)]
  },
})
```

`on` gates when the subtree rebuilds; `sample` reads the current state snapshot without creating a binding. Stats changes that don't bump the epoch do not trigger a rebuild. Stats bindings inside `render` would — which is why we sample here instead.

**Avoid the old workaround.** Before `scope()`, authors used `each()` with a singleton-array + closure-captured snapshot:

```ts
// Do not do this
let chartSnap: Stats | null = null
each({
  items: (s) => { chartSnap = s.stats; return [s.chartEpoch] },
  key: (n) => String(n),
  render: () => chartView(chartSnap!),
})
```

`scope({ on, render }) + sample` is the idiomatic replacement.
````

- [ ] **Step 7: Regenerate llms output**

```bash
cd site && pnpm tsx src/generate-llms.ts
```

`site/public/llms.txt` and `site/public/llms-full.txt` regenerate.

- [ ] **Step 8: Verify monorepo check/test/build**

```bash
cd /Users/franco/projects/llui
pnpm turbo check test build --force
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: scope() + sample() API reference, cookbook, Lifetime rename"
```

---

## Phase 8 — Final verification + land

### Task 8.1: Full-repo smoke check

- [ ] **Step 1: Clean build**

```bash
cd /Users/franco/projects/llui
pnpm turbo clean
pnpm install
pnpm turbo check test build
```

Expected: 28 tasks green.

- [ ] **Step 2: Lint**

```bash
pnpm turbo lint
```

Expected: green.

- [ ] **Step 3: Prettier**

```bash
pnpm format:check
```

Expected: green, or run `pnpm format` and commit formatting.

### Task 8.2: Review commit series

- [ ] **Step 1: Inspect commits**

```bash
git log main..HEAD --oneline
```

Expected series (approx):
```
docs: scope() + sample() API reference, cookbook, Lifetime rename
test(dom): end-to-end scope() + sample() integration
feat(vite-plugin): recognize scope() and sample() in path scanner + mask injection
feat(dom): scope() primitive for keyed subtree rebuild
feat(dom): exhaustiveness typing for branch() cases/default
feat(dom): branch() accepts default case for non-matching keys
feat(dom): add sample() for imperative state reads
refactor: update @llui/{vike,test,components,mcp} for Lifetime rename
refactor(dom): rename internal Scope type to Lifetime
```

Matches the atomic landing story: the rename precedes the primitive adds; typing change is its own commit for clarity.

### Task 8.3: Merge into `main`

- [ ] **Step 1: Rebase onto latest main (if main moved)**

```bash
git fetch origin
git rebase origin/main
```

Resolve conflicts if any; re-run `pnpm turbo check test`.

- [ ] **Step 2: Merge**

If main branch policy allows fast-forward:

```bash
git checkout main
git merge --ff-only scope-primitive
```

Or preserve the commit series as-is (pre-v1, merge policy is up to the maintainer).

- [ ] **Step 3: Cleanup worktree**

```bash
cd /Users/franco/projects/llui
git worktree remove ../llui-scope-primitive
```

### Task 8.4: Publish (separate step, coordinated via `scripts/publish.sh`)

Out of scope for this plan — the publish flow is owned by the repo's release scripts (`scripts/publish.sh`) and coordinated by the maintainer. The plan lands the change; publication is a follow-up.

---

## Verification gates (summary)

Each phase has a clear gate:

| Phase | Gate |
|---|---|
| 1 | `pnpm turbo check test` green after rename |
| 2 | `pnpm vitest run test/view-sample.test.ts` green |
| 3 | `pnpm turbo check test` green after default + show fix |
| 4 | `branch-exhaustive-types.test.ts` green |
| 5 | `scope.test.ts` + full repo green |
| 6 | `scope-compiler.test.ts` + diagnostics test green |
| 7 | `scope-integration.test.ts` + full `pnpm turbo check test build` green |
| 8 | clean build + lint + format green |

If a gate fails, stop — fix before proceeding to the next phase.

---

## Notes for the executing engineer

- **Rename discipline:** Do the `Lifetime` rename in one pass with a tool that won't miss identifiers. Use VSCode's F2 rename symbol on the interface, or a careful `sed` with boundary regex. Do NOT hand-edit file-by-file — skipping an import leaves a red herring later.
- **Exhaustiveness typing gotcha:** If `branch({ on, cases })` call sites don't narrow `on`'s return to a literal union, TypeScript infers `K = string` (wide), which forces `default` required. Existing call sites that were fine with a wide `on` may need either a narrow type annotation or a `default` case. This is intended — the spec explicitly accepts this as a pre-v1 breaking change.
- **`show` internal generics:** `show.ts` now wraps `when` in `String(...)` and passes `cases: { true, false }`. The inferred `K = 'true' | 'false'` is exhaustive against `{ true, false }`, so no default is needed — TS enforces this correctly.
- **Compiler `__mask` forwarding:** The `scope()` runtime function spreads `__mask` from its own options to branch. Verify this works end-to-end by checking a compiled output (run `pnpm turbo build` on a consumer package and grep the emitted JS).
- **`sample` outside render:** The guard throws via `getRenderContext('sample')`. Verify the error message format matches the surrounding conventions.
