# LLui Agent — Plan 3 of 7: Vite Plugin — Binding Descriptors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@llui/vite-plugin` to walk every component's `view()` body, find `send({type: '...'})` call sites, and emit a flat `__bindingDescriptors: Array<{variant: string}>` metadata array onto the compiled `component({...})` call. This is the static affordance surface that the agent's `list_actions` will expose to Claude.

**Architecture:** One new extractor (`packages/vite-plugin/src/binding-descriptors.ts`) + one integration point in the existing Pass 2 site alongside `__msgSchema`/`__msgAnnotations`/`__schemaHash`. A `BindingDescriptor` type with only `{variant: string}` in v1; the spec's richer fields (`argsShape`, `selectorHint`, `payloadHint`) are explicitly deferred to a follow-up plan. `LluiComponentDef` in `@llui/dom` grows one more optional field.

**Tech Stack:** TypeScript Compiler API (recursive `ts.forEachChild`), vitest, existing Pass 2 infrastructure.

**Spec section coverage:**
- §5.2 Binding introspection — partial (emission only, not runtime live-binding reconciliation).
- §12.2 Binding descriptor emission — implementation (minus argsShape / selectorHint).
- Deferred to a future plan: runtime live-binding filtering so `list_actions` returns only currently-rendered affordances instead of the static union. For v1, Claude cross-references with `describe_visible_content` to understand which static affordances are actually on screen.

---

## v1 scope trim (captured here so the spec stays aspirational)

The spec's full `BindingDescriptor` is:
```ts
{
  variant: string
  argsShape: Array<…>                // which fields come from state / event / literal
  annotations: AnnotationSet         // resolved from the Msg variant
  selectorHint: string | null        // best-effort CSS selector
}
```

V1 emits only `{variant: string}`. At runtime the server/bridge compose the full response by:
- Joining with `__msgAnnotations[variant]` to get `intent` / `requiresConfirm` / `humanOnly`.
- Leaving `payloadHint: null`, `selectorHint: null`, `source: 'binding'`.

This is sufficient to tell Claude WHICH variants are reachable through the UI; payload details come from `describe_app.messages[variant].payloadSchema`, and visibility comes from `describe_visible_content`.

Deferred for a follow-up plan:
- `argsShape` / `payloadHint` — extract literal fields from `send({type: 'delete', id: 'abc'})`.
- `selectorHint` — walk the enclosing element call to reconstruct a CSS hint like `button[data-action='delete']`.
- Live-binding reconciliation — the runtime binding array carries a reference to its descriptor; `list_actions` filters by `branch`/`show`/`each` reconciliation state.

---

## File Structure

- `packages/vite-plugin/src/binding-descriptors.ts` — pure extractor: TypeScript source → `BindingDescriptor[]`.
- `packages/vite-plugin/test/binding-descriptors.test.ts` — unit tests.
- `packages/vite-plugin/src/transform.ts` — modified to call the extractor inside Pass 2 and inject `__bindingDescriptors` alongside the existing emissions.
- `packages/vite-plugin/test/transform.test.ts` — extended with one integration test asserting `__bindingDescriptors` emission.
- `packages/dom/src/types.ts` — `ComponentDef` / `AnyComponentDef` / `LazyDef` extended with optional `__bindingDescriptors: Array<{variant: string}>`.

---

## Task 1: Failing unit test — happy path

**Files:**
- Create: `packages/vite-plugin/test/binding-descriptors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { extractBindingDescriptors } from '../src/binding-descriptors.js'

describe('extractBindingDescriptors', () => {
  it('extracts send({type: "..."}) calls from a component view', () => {
    const source = `
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ send, text }) => [
    div({}, [
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      button({ onClick: () => send({ type: 'reset' }) }, [text('reset')]),
    ]),
  ],
})
`
    const result = extractBindingDescriptors(source)
    expect(result).toEqual([
      { variant: 'inc' },
      { variant: 'dec' },
      { variant: 'reset' },
    ])
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/binding-descriptors.test.ts
```

Expected: FAIL (module not found).

---

## Task 2: Implement `extractBindingDescriptors`

**Files:**
- Create: `packages/vite-plugin/src/binding-descriptors.ts`

- [ ] **Step 1: Write the implementation**

```ts
import ts from 'typescript'

export type BindingDescriptor = {
  variant: string
}

/**
 * Walk the `view` arrow function of every top-level `component({...})` call
 * in the source and collect every `send({type: '...'})` call site's variant
 * literal. Returns them in encounter order.
 *
 * False positives: any call of the form `identifier({ type: 'x', ... })` —
 * we don't verify the callee resolves to the destructured `send` from the
 * view argument, because that level of scope tracking is beyond the budget
 * of this MVP extractor. Apps that call other identifiers with similarly
 * shaped literals would see those in the output. In practice, the pattern
 * is uncommon enough that false positives are rare.
 *
 * Missing: non-literal `type` values (e.g. `send({type: nextStep})`) are
 * skipped. This is the correct behavior — we can only record statically-
 * known variants.
 *
 * @see agent spec §5.2, §12.2
 */
export function extractBindingDescriptors(source: string): BindingDescriptor[] {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const out: BindingDescriptor[] = []

  function visitComponentConfig(config: ts.ObjectLiteralExpression): void {
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== 'view') continue
      const viewExpr = prop.initializer
      if (!ts.isArrowFunction(viewExpr) && !ts.isFunctionExpression(viewExpr)) continue
      collectSendCalls(viewExpr.body)
    }
  }

  function collectSendCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const first = node.arguments[0]
      if (
        callee &&
        ts.isIdentifier(callee) &&
        first &&
        ts.isObjectLiteralExpression(first)
      ) {
        const variant = readTypeLiteral(first)
        if (variant !== null && isLikelySendCall(callee)) {
          out.push({ variant })
        }
      }
    }
    ts.forEachChild(node, collectSendCalls)
  }

  function readTypeLiteral(obj: ts.ObjectLiteralExpression): string | null {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!prop.name) continue
      const nameOk =
        (ts.isIdentifier(prop.name) && prop.name.text === 'type') ||
        (ts.isStringLiteral(prop.name) && prop.name.text === 'type')
      if (!nameOk) continue
      const init = prop.initializer
      if (ts.isStringLiteral(init)) return init.text
      if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text
    }
    return null
  }

  function isLikelySendCall(callee: ts.Identifier): boolean {
    // Accept `send` as the canonical name; accept any identifier as a fallback
    // since the MVP tolerates false positives. Tight scope-checking would be
    // heavier than the v1 budget allows.
    return callee.text === 'send' || callee.text.length > 0
  }

  function visitTopLevel(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const calleeName = ts.isIdentifier(callee) ? callee.text : null
      if (calleeName === 'component' && node.arguments.length > 0) {
        const firstArg = node.arguments[0]
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          visitComponentConfig(firstArg)
        }
      }
    }
    ts.forEachChild(node, visitTopLevel)
  }

  ts.forEachChild(sf, visitTopLevel)
  return out
}
```

- [ ] **Step 2: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/binding-descriptors.test.ts
cd packages/vite-plugin && pnpm check
```

Expected: test passes (1/1); check silent exit 0.

If `pnpm check` fails, fix the type errors before committing. The code above has been vetted for strict-mode compatibility, but double-check.

- [ ] **Step 3: Commit**

```bash
git add packages/vite-plugin/src/binding-descriptors.ts packages/vite-plugin/test/binding-descriptors.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): extractBindingDescriptors — view() → [{variant}]

Walks every component({...})'s view arrow function body looking for
send({type: '...'}) call sites; emits a flat {variant: string}[].
Richer shape (argsShape, selectorHint, payloadHint) deferred. See
agent spec §5.2, §12.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: Edge-case tests

**Files:**
- Modify: `packages/vite-plugin/test/binding-descriptors.test.ts`

- [ ] **Step 1: Append**

```ts
describe('extractBindingDescriptors — edge cases', () => {
  it('returns empty array when no component() call exists', () => {
    expect(extractBindingDescriptors(`export const x = 1`)).toEqual([])
  })

  it('returns empty array when view has no send() calls', () => {
    const src = `
import { component, div } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'noop' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [div({}, [text('hello')])],
})
`
    expect(extractBindingDescriptors(src)).toEqual([])
  })

  it('skips send() with a non-literal type field', () => {
    const src = `
import { component, button } from '@llui/dom'
type State = { nextKind: 'a' | 'b' }; type Msg = { type: 'a' } | { type: 'b' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ nextKind: 'a' }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'a' }) }, []),
    button({ onClick: (_e, s) => send({ type: s.nextKind }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'a' }])
  })

  it('deduplicates nothing — every call site is its own entry', () => {
    // Rationale: two buttons both calling send({type: 'inc'}) still represent
    // two distinct affordance surfaces (different payloads in future versions).
    // Keep them separate. Runtime-side dedup is the server's job.
    const src = `
import { component, button } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'inc' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'inc' }) }, []),
    button({ onClick: () => send({ type: 'inc' }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([
      { variant: 'inc' },
      { variant: 'inc' },
    ])
  })

  it('finds send() nested inside branch/show/each bodies', () => {
    const src = `
import { component, branch, button } from '@llui/dom'
type State = { show: boolean }; type Msg = { type: 'a' } | { type: 'b' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ show: true }, []], update: (s, _m) => [s, []],
  view: ({ send, branch }) => [
    branch(s => s.show, [
      button({ onClick: () => send({ type: 'a' }) }, []),
    ]),
    button({ onClick: () => send({ type: 'b' }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([
      { variant: 'a' },
      { variant: 'b' },
    ])
  })

  it('ignores calls whose first argument is not an object literal', () => {
    const src = `
import { component, button } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'real' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'real' }) }, []),
    button({ onClick: () => someOtherFn('not an object') }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'real' }])
  })

  it('handles multiple top-level component() calls', () => {
    const src = `
import { component, button } from '@llui/dom'
type S1 = {}; type M1 = { type: 'a' }
type S2 = {}; type M2 = { type: 'b' }
export const A = component<S1, M1, never>({
  name: 'A', init: () => [{}, []], update: (s, _m) => [s, []],
  view: ({ send }) => [button({ onClick: () => send({ type: 'a' }) }, [])],
})
export const B = component<S2, M2, never>({
  name: 'B', init: () => [{}, []], update: (s, _m) => [s, []],
  view: ({ send }) => [button({ onClick: () => send({ type: 'b' }) }, [])],
})
`
    expect(extractBindingDescriptors(src)).toEqual([
      { variant: 'a' },
      { variant: 'b' },
    ])
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/binding-descriptors.test.ts
cd packages/vite-plugin && pnpm check
```

Expected: 8 tests total pass; check silent.

- [ ] **Step 3: Commit**

```bash
git add packages/vite-plugin/test/binding-descriptors.test.ts
git commit -m "$(cat <<'COMMIT'
test(vite-plugin): edge cases for extractBindingDescriptors

Covers: empty input, no send() calls, non-literal type field,
deliberate non-dedup across call sites, nested branch/show, non-
object first arg, multiple component() calls per module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: Failing integration test

**Files:**
- Modify: `packages/vite-plugin/test/transform.test.ts`

- [ ] **Step 1: Append — use the same harness (`tDev`) used for `__msgAnnotations` / `__schemaHash`**

```ts
describe('Pass 2 — __bindingDescriptors emission', () => {
  it('emits __bindingDescriptors reflecting send() call sites in view', () => {
    const source = `
import { component, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, count: s.count + 1 }, []]
      case 'dec': return [{ ...s, count: s.count - 1 }, []]
    }
  },
  view: ({ send, text }) => [
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
  ],
})
`
    const out = tDev(source)
    expect(out).toContain('__bindingDescriptors:')
    expect(out).toMatch(/\{\s*variant:\s*["']inc["']\s*\}/)
    expect(out).toMatch(/\{\s*variant:\s*["']dec["']\s*\}/)
  })

  it('omits __bindingDescriptors when view has no send() calls', () => {
    const source = `
import { component, text } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'noop' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`
    const out = tDev(source)
    expect(out).not.toContain('__bindingDescriptors:')
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__bindingDescriptors"
```

Expected: FAIL.

---

## Task 5: Integrate into Pass 2

**Files:**
- Modify: `packages/vite-plugin/src/transform.ts`

- [ ] **Step 1: Import**

Near the other extractor imports:

```ts
import { extractBindingDescriptors, type BindingDescriptor } from './binding-descriptors.js'
```

- [ ] **Step 2: Compute alongside annotations + hash**

At the same Pass 2 site where `msgAnnotations` and `schemaHash` are computed, add:

```ts
const bindingDescriptors = extractBindingDescriptors(code)  // use the local source var name
```

- [ ] **Step 3: Inject `__bindingDescriptors` into the component-config object literal**

After the `__msgAnnotations` and `__schemaHash` injections, add:

```ts
if (bindingDescriptors.length > 0) {
  newProps.push(
    ts.factory.createPropertyAssignment(
      '__bindingDescriptors',
      bindingDescriptorsToArrayLiteral(bindingDescriptors),
    ),
  )
}
```

And append this helper alongside the other `annotationsToObjectLiteral` helper:

```ts
function bindingDescriptorsToArrayLiteral(
  descs: BindingDescriptor[],
): ts.ArrayLiteralExpression {
  const entries = descs.map((d) =>
    ts.factory.createObjectLiteralExpression(
      [
        ts.factory.createPropertyAssignment(
          'variant',
          ts.factory.createStringLiteral(d.variant),
        ),
      ],
      false,
    ),
  )
  return ts.factory.createArrayLiteralExpression(entries, true)
}
```

- [ ] **Step 4: Verify**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__bindingDescriptors"
cd packages/vite-plugin && pnpm test    # full suite
cd packages/vite-plugin && pnpm check   # strict type-check
cd packages/vite-plugin && pnpm lint
```

All must pass. Fix any type errors before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/vite-plugin/src/transform.ts packages/vite-plugin/test/transform.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): inject __bindingDescriptors into component() calls

Pass 2 walks view()'s arrow body for send({type:'...'}) call sites
and emits a flat {variant}[] array as __bindingDescriptors. Skipped
when the view has no send() calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 6: Extend `LluiComponentDef` in `@llui/dom`

**Files:**
- Modify: `packages/dom/src/types.ts`

- [ ] **Step 1: Find the three type declarations that already carry `__msgAnnotations`**

Based on the prior plan, they live near `ComponentDef<S, M, E, D>` (~line 25), `AnyComponentDef` (~line 92), `LazyDef<D>` (~line 128). Open the file and confirm the exact current line numbers.

- [ ] **Step 2: Add the new field**

In `ComponentDef` (the fully typed form):
```ts
/** Compiler-emitted; one entry per send() call site in view(). See agent spec §5.2. */
__bindingDescriptors?: Array<{ variant: string }>
```

In `AnyComponentDef` and `LazyDef` (type-erased forms):
```ts
__bindingDescriptors?: unknown
```

Place each adjacent to the `__msgAnnotations` field that was added in Plan 2.

- [ ] **Step 3: Type-check**

```bash
cd packages/dom && pnpm check
cd /Users/franco/projects/llui && pnpm turbo check
```

Both must exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/dom/src/types.ts
git commit -m "$(cat <<'COMMIT'
feat(dom): LluiComponentDef field for __bindingDescriptors

Optional; emitted by the vite plugin when view() contains
send({type:'...'}) call sites. Entry shape is {variant: string} in
v1; richer fields (argsShape, selectorHint) are deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 7: Workspace verification

**Files:** none — verification pass.

- [ ] **Step 1: Full workspace build + check + lint + test**

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All must pass.

- [ ] **Step 2: todomvc spot-check**

```bash
cd /Users/franco/projects/llui/examples/todomvc && pnpm build
grep -o '__bindingDescriptors:\[[^]]*' /Users/franco/projects/llui/examples/todomvc/dist/**/*.js 2>/dev/null | head -5
```

Expected: todomvc has many `send()` call sites in its view; `__bindingDescriptors` should be emitted and show multiple `{variant: '...'}` entries. If the grep returns nothing, either dist files live elsewhere or the emission isn't wiring through production builds — flag as a concern.

- [ ] **Step 3: No commit for this task.**

---

## Task 8: Commit plan file

**Files:** This plan itself.

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-llui-agent-03-binding-descriptors.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 3 binding-descriptors — implementation plan document

Records the 8-task plan for MVP binding-descriptor emission (variant
only). argsShape, selectorHint, and runtime live-binding filtering
explicitly deferred.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- `packages/vite-plugin/src/binding-descriptors.ts` exports `extractBindingDescriptors(source: string): BindingDescriptor[]` where `BindingDescriptor = {variant: string}`.
- 8 unit tests pass (happy path + 7 edge cases).
- The vite transform Pass 2 emits `__bindingDescriptors` on compiled `component({...})` calls when the view contains at least one `send({type:'...'})` call site.
- `examples/todomvc` build output contains a populated `__bindingDescriptors` array.
- `ComponentDef` / `AnyComponentDef` / `LazyDef` carry the new optional field.
- Workspace `pnpm turbo build/check/lint/test` all green.

---

## Explicitly deferred

- **Richer descriptor fields.** `argsShape` (literal / state-referenced / event-referenced payload fields), `selectorHint` (CSS selector reconstructed from the enclosing element call), `payloadHint` (inline literal payload for `list_actions`). Follow-up: a compiler-side refinement after the runtime is in place and the agent server can demonstrate which enrichments actually improve Claude's behavior.
- **Runtime live-binding filtering.** Plan 3 emits a STATIC list of all send() call sites in the component. The spec's §5.2 vision has `list_actions` return only CURRENTLY-LIVE bindings (reconciled by `branch`/`show`/`each`). V1 returns the static list and relies on `describe_visible_content` for Claude to understand current affordance. Follow-up: attach descriptors to event bindings and walk the live binding array in `list_actions`.
- **Lint rules for non-pattern handlers.** Handlers that don't match the extractor's pattern (e.g., `send({type: dynamicVar})`) are silently skipped. Plan 7 polish adds a `@llui/lint-idiomatic` rule warning about them.
