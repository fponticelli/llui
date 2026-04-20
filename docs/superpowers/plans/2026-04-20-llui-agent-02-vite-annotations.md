# LLui Agent — Plan 2 of 7: Vite Plugin — JSDoc Annotations + Schema Hash

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@llui/vite-plugin` to extract JSDoc annotations (`@intent`, `@alwaysAffordable`, `@requiresConfirm`, `@humanOnly`) from Msg union variants and emit them as a parallel `__msgAnnotations` record on the component definition. Also compute and emit `__schemaHash` for dev-time cache invalidation.

**Architecture:** Two new extractors under `packages/vite-plugin/src/` — `msg-annotations.ts` (TypeScript AST + leading-comment walk) and `schema-hash.ts` (stable SHA-256 over normalized JSON). Both integrate into the existing Pass 2 `injectMsgSchema` site, attaching new properties to the `component({...})` call's object literal. `@llui/dom`'s `LluiComponentDef` type gains two new optional fields. No changes to the emission shape of the existing `__msgSchema`, `__stateSchema`, or `__effectSchema` — the new fields are strictly additive.

**Tech Stack:** TypeScript Compiler API (`ts.createSourceFile`, `ts.forEachChild`, `ts.getLeadingCommentRanges`), Node `crypto.createHash('sha256')`, vitest.

**Spec section coverage after this plan:**

- §5.1 Annotations — emission.
- §12.1 Annotation extraction — implementation.
- §12.3 `schemaHash` — implementation.
- Deferred to Plan 3: §5.2 Binding descriptors, §12.2 Binding descriptor emission.

---

## File Structure

- `packages/vite-plugin/src/msg-annotations.ts` — pure extractor: source text → `Record<string, MessageAnnotations>`.
- `packages/vite-plugin/src/schema-hash.ts` — pure function: schemas + annotations → stable hash string.
- `packages/vite-plugin/test/msg-annotations.test.ts` — unit tests for the extractor.
- `packages/vite-plugin/test/schema-hash.test.ts` — unit tests for the hash.
- `packages/vite-plugin/src/transform.ts` — modified to call the two new extractors inside Pass 2 and inject `__msgAnnotations` + `__schemaHash` alongside the existing `__msgSchema` emission.
- `packages/vite-plugin/test/transform.test.ts` — extended with integration cases asserting the new properties appear on the emitted component call.
- `packages/dom/src/types.ts` — `LluiComponentDef` extended with optional `__msgAnnotations` and `__schemaHash` fields.

---

## Task 1: Write failing unit test for `extractMsgAnnotations` — happy path

**Files:**

- Create: `packages/vite-plugin/test/msg-annotations.test.ts`

- [ ] **Step 1: Create the test file with a single failing test**

```ts
import { describe, it, expect } from 'vitest'
import { extractMsgAnnotations } from '../src/msg-annotations.js'

describe('extractMsgAnnotations', () => {
  it('reads @intent, @requiresConfirm, @humanOnly, @alwaysAffordable from union member JSDoc', () => {
    const source = `
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' }
`
    const result = extractMsgAnnotations(source)
    expect(result).toEqual({
      inc: {
        intent: 'Increment the counter',
        alwaysAffordable: false,
        requiresConfirm: false,
        humanOnly: false,
      },
      delete: {
        intent: 'Delete item',
        alwaysAffordable: false,
        requiresConfirm: true,
        humanOnly: false,
      },
      checkout: {
        intent: 'Place order',
        alwaysAffordable: false,
        requiresConfirm: false,
        humanOnly: true,
      },
      nav: {
        intent: 'Navigate',
        alwaysAffordable: true,
        requiresConfirm: false,
        humanOnly: false,
      },
    })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd packages/vite-plugin && pnpm vitest run test/msg-annotations.test.ts
```

Expected: FAIL (module not found or extractor returns wrong shape).

---

## Task 2: Implement `extractMsgAnnotations`

**Files:**

- Create: `packages/vite-plugin/src/msg-annotations.ts`

- [ ] **Step 1: Implement the extractor**

```ts
import ts from 'typescript'

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

const DEFAULT: MessageAnnotations = {
  intent: null,
  alwaysAffordable: false,
  requiresConfirm: false,
  humanOnly: false,
}

/**
 * Walk a Msg-like discriminated-union type alias and extract JSDoc
 * annotations attached to each union member. Returns null if no
 * recognizable union is found so callers can skip emission cleanly.
 *
 * Expected JSDoc grammar (order-independent):
 *   @intent("human readable")
 *   @alwaysAffordable
 *   @requiresConfirm
 *   @humanOnly
 *
 * Unknown tags are ignored; malformed @intent (no quoted string) is
 * treated as "no intent". The four flags are booleans; any occurrence
 * of the tag sets it true.
 */
export function extractMsgAnnotations(source: string): Record<string, MessageAnnotations> | null {
  const sf = ts.createSourceFile('msg.ts', source, ts.ScriptTarget.Latest, true)
  const aliases: ts.TypeAliasDeclaration[] = []
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n)) aliases.push(n)
  })
  // Prefer an alias named exactly `Msg`; fall back to the last union alias seen.
  const named = aliases.find((a) => a.name.text === 'Msg')
  const alias = named ?? aliases.find((a) => ts.isUnionTypeNode(a.type))
  if (!alias || !ts.isUnionTypeNode(alias.type)) return null

  const result: Record<string, MessageAnnotations> = {}
  for (const member of alias.type.types) {
    if (!ts.isTypeLiteralNode(member)) continue
    const variant = readDiscriminantLiteral(member)
    if (!variant) continue
    const comment = readLeadingJSDoc(source, member)
    result[variant] = parseAnnotations(comment)
  }
  return Object.keys(result).length === 0 ? null : result
}

function readDiscriminantLiteral(lit: ts.TypeLiteralNode): string | null {
  for (const m of lit.members) {
    if (!ts.isPropertySignature(m)) continue
    if (!m.name || !ts.isIdentifier(m.name) || m.name.text !== 'type') continue
    if (!m.type || !ts.isLiteralTypeNode(m.type)) continue
    const lit = m.type.literal
    if (ts.isStringLiteral(lit)) return lit.text
  }
  return null
}

function readLeadingJSDoc(source: string, node: ts.Node): string {
  // Union member nodes don't carry getJSDocTags directly — their JSDoc
  // is leading trivia on the BarToken/member. Walk leading comment
  // ranges from the node's full start.
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []
  const docs = ranges
    .filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia)
    .map((r) => source.slice(r.pos, r.end))
    .filter((txt) => txt.startsWith('/**'))
  return docs.join('\n')
}

function parseAnnotations(comment: string): MessageAnnotations {
  if (!comment) return { ...DEFAULT }
  const intent = readIntent(comment)
  return {
    intent,
    alwaysAffordable: /@alwaysAffordable\b/.test(comment),
    requiresConfirm: /@requiresConfirm\b/.test(comment),
    humanOnly: /@humanOnly\b/.test(comment),
  }
}

function readIntent(comment: string): string | null {
  // @intent("...") — accept both straight and curly double quotes.
  const match = comment.match(/@intent\s*\(\s*["\u201c]([^"\u201d]*)["\u201d]\s*\)/)
  return match ? match[1] : null
}
```

- [ ] **Step 2: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/msg-annotations.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/vite-plugin/src/msg-annotations.ts packages/vite-plugin/test/msg-annotations.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): extractMsgAnnotations — JSDoc → MessageAnnotations

Parses @intent("..."), @alwaysAffordable, @requiresConfirm, @humanOnly
from Msg union member JSDoc. Pure function; no Vite integration yet.
See agent spec §5.1, §12.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 3: Add unit tests for edge cases

**Files:**

- Modify: `packages/vite-plugin/test/msg-annotations.test.ts`

- [ ] **Step 1: Append edge-case tests**

```ts
describe('extractMsgAnnotations — edge cases', () => {
  it('returns null when no Msg alias exists', () => {
    expect(extractMsgAnnotations(`type Other = { foo: string }`)).toBeNull()
  })

  it('returns null when the alias is not a union', () => {
    expect(extractMsgAnnotations(`type Msg = { type: 'x' }`)).toBeNull()
  })

  it('skips union members that are not object literals', () => {
    const src = `
type Msg =
  /** @intent("real") */
  | { type: 'ok' }
  | string
  | number
`
    expect(extractMsgAnnotations(src)).toEqual({
      ok: { intent: 'real', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
    })
  })

  it('skips union members without a string-literal discriminant', () => {
    const src = `
type Msg =
  /** @intent("real") */
  | { type: 'ok' }
  | { type: string; id: number }
`
    expect(extractMsgAnnotations(src)).toEqual({
      ok: { intent: 'real', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
    })
  })

  it('defaults all fields when no JSDoc is attached', () => {
    const src = `
type Msg =
  | { type: 'a' }
  | { type: 'b' }
`
    expect(extractMsgAnnotations(src)).toEqual({
      a: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
      b: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
    })
  })

  it('ignores unknown tags', () => {
    const src = `
type Msg =
  /** @intent("x") @someOtherTag @foo */
  | { type: 'a' }
`
    const r = extractMsgAnnotations(src)
    expect(r?.a).toEqual({
      intent: 'x',
      alwaysAffordable: false,
      requiresConfirm: false,
      humanOnly: false,
    })
  })

  it('prefers the alias literally named Msg over the last union', () => {
    const src = `
type Other =
  /** @intent("wrong") */
  | { type: 'nope' }
type Msg =
  /** @intent("right") */
  | { type: 'ok' }
`
    const r = extractMsgAnnotations(src)
    expect(r).toEqual({
      ok: { intent: 'right', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
    })
  })

  it('handles @intent with straight double quotes only (curly optional)', () => {
    const src = `
type Msg =
  /** @intent("straight") */
  | { type: 'a' }
`
    expect(extractMsgAnnotations(src)?.a.intent).toBe('straight')
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/msg-annotations.test.ts
```

Expected: PASS (8 tests total: 1 from Task 1 + 7 new).

- [ ] **Step 3: Commit**

```bash
git add packages/vite-plugin/test/msg-annotations.test.ts
git commit -m "$(cat <<'COMMIT'
test(vite-plugin): edge cases for extractMsgAnnotations

Covers: missing/non-union aliases, non-object members, non-literal
discriminants, empty JSDoc (defaults), unknown tags, alias-name
preference, quote handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: Failing integration test — transform emits `__msgAnnotations`

**Files:**

- Modify: `packages/vite-plugin/test/transform.test.ts`

- [ ] **Step 1: Read the existing test file to understand the transform-test fixture pattern**

Look at the top of `packages/vite-plugin/test/transform.test.ts` for the shared helper (typically a `runTransform` or inline `transform` call). Use the same helper for the new test.

- [ ] **Step 2: Append a failing integration test**

Append to `packages/vite-plugin/test/transform.test.ts`. Adapt the helper-call shape to match the existing tests in that file — the following is the test's content; substitute whatever harness the file already uses for running transforms:

```ts
describe('Pass 2 — __msgAnnotations emission', () => {
  it('emits __msgAnnotations alongside __msgSchema for annotated Msg variants', () => {
    const source = `
import { component } from '@llui/dom'

type State = { count: number }
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, count: s.count + 1 }, []]
      case 'delete': return [s, []]
    }
  },
  view: ({ send, text }) => [text((s) => String(s.count))],
})
`
    const out = runTransform(source) // or whichever harness the file already uses
    expect(out).toContain('__msgAnnotations:')
    // The emitted object literal should contain both variant keys:
    expect(out).toMatch(/inc:\s*\{\s*intent:\s*["']Increment the counter["']/)
    expect(out).toMatch(
      /delete:\s*\{\s*intent:\s*["']Delete item["'][\s\S]*requiresConfirm:\s*true/,
    )
  })

  it('omits __msgAnnotations when no variants carry annotations (fallback to default behavior)', () => {
    const source = `
import { component } from '@llui/dom'

type State = { n: number }
type Msg = { type: 'x' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ n: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`
    const out = runTransform(source)
    // Bare variants with no JSDoc produce an object where every field equals DEFAULT;
    // to keep compiled output small we ALSO skip emission entirely when every variant
    // is fully default. See implementation comment in Task 5.
    expect(out).not.toContain('__msgAnnotations:')
  })
})
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__msgAnnotations"
```

Expected: FAIL — the transform does not yet emit `__msgAnnotations`.

---

## Task 5: Integrate `extractMsgAnnotations` into Pass 2

**Files:**

- Modify: `packages/vite-plugin/src/transform.ts`

- [ ] **Step 1: Import the extractor**

At the top of `packages/vite-plugin/src/transform.ts` alongside the other extractor imports, add:

```ts
import { extractMsgAnnotations, type MessageAnnotations } from './msg-annotations.js'
```

- [ ] **Step 2: Extend the existing `injectMsgSchema` site**

Find the `// ── __msgSchema injection ────────────────────────────────────────` block (around line 2993, introduced in the existing Pass 2 code). Just after the line that computes the msgSchema value (e.g. a `const msgSchema = extractMsgSchema(...)`), add:

```ts
const msgAnnotations = extractMsgAnnotations(source)
```

Where `source` is the raw module source string the transform is working on. (If the surrounding function doesn't already hold it as `source`, look for the variable name in scope — typically `code` or `text`.)

- [ ] **Step 3: Inject `__msgAnnotations` into the component-call object literal**

Locate the code that builds the new component-config object literal in Pass 2 (it already inserts `__msgSchema`, `__dirty`, `__update`, `__componentMeta`). Add a sibling property when `msgAnnotations` is non-null AND at least one variant has a non-default annotation:

```ts
if (msgAnnotations && hasNonDefaultAnnotation(msgAnnotations)) {
  newProps.push(
    ts.factory.createPropertyAssignment(
      '__msgAnnotations',
      annotationsToObjectLiteral(msgAnnotations),
    ),
  )
}
```

Where the two helpers live below (append to the file, in the same module-private utilities area):

```ts
function hasNonDefaultAnnotation(a: Record<string, MessageAnnotations>): boolean {
  for (const v of Object.values(a)) {
    if (v.intent !== null) return true
    if (v.alwaysAffordable) return true
    if (v.requiresConfirm) return true
    if (v.humanOnly) return true
  }
  return false
}

function annotationsToObjectLiteral(
  a: Record<string, MessageAnnotations>,
): ts.ObjectLiteralExpression {
  const props: ts.PropertyAssignment[] = []
  for (const [variant, ann] of Object.entries(a)) {
    props.push(
      ts.factory.createPropertyAssignment(
        variant,
        ts.factory.createObjectLiteralExpression(
          [
            ts.factory.createPropertyAssignment(
              'intent',
              ann.intent === null
                ? ts.factory.createNull()
                : ts.factory.createStringLiteral(ann.intent),
            ),
            ts.factory.createPropertyAssignment(
              'alwaysAffordable',
              ann.alwaysAffordable ? ts.factory.createTrue() : ts.factory.createFalse(),
            ),
            ts.factory.createPropertyAssignment(
              'requiresConfirm',
              ann.requiresConfirm ? ts.factory.createTrue() : ts.factory.createFalse(),
            ),
            ts.factory.createPropertyAssignment(
              'humanOnly',
              ann.humanOnly ? ts.factory.createTrue() : ts.factory.createFalse(),
            ),
          ],
          true,
        ),
      ),
    )
  }
  return ts.factory.createObjectLiteralExpression(props, true)
}
```

- [ ] **Step 4: Run the integration test**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__msgAnnotations"
```

Expected: PASS.

- [ ] **Step 5: Run the full vite-plugin test suite to confirm no regressions**

```bash
cd packages/vite-plugin && pnpm test
```

Expected: all pass (no pre-existing tests should break).

- [ ] **Step 6: Commit**

```bash
git add packages/vite-plugin/src/transform.ts packages/vite-plugin/test/transform.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): inject __msgAnnotations into component() calls

Pass 2 now emits a parallel __msgAnnotations record keyed by variant
discriminant, carrying intent/alwaysAffordable/requiresConfirm/humanOnly
extracted from Msg union JSDoc. Skipped when every variant is default.
See agent spec §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 6: Failing unit test for `computeSchemaHash`

**Files:**

- Create: `packages/vite-plugin/test/schema-hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { computeSchemaHash } from '../src/schema-hash.js'

describe('computeSchemaHash', () => {
  it('produces a stable hex string for the same input', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: { count: 'number' },
      msgAnnotations: null,
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: { count: 'number' },
      msgAnnotations: null,
    })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16,}$/) // hex; allow 16+ chars so we can truncate if we want
  })

  it('is stable under key-order permutation', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {}, dec: {} } },
      stateSchema: { count: 'number', name: 'string' },
      msgAnnotations: null,
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { dec: {}, inc: {} } },
      stateSchema: { name: 'string', count: 'number' },
      msgAnnotations: null,
    })
    expect(a).toBe(b)
  })

  it('changes when msgSchema changes', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: null,
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {}, dec: {} } },
      stateSchema: {},
      msgAnnotations: null,
    })
    expect(a).not.toBe(b)
  })

  it('changes when stateSchema changes', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: {} },
      stateSchema: { count: 'number' },
      msgAnnotations: null,
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: {} },
      stateSchema: { count: 'number', name: 'string' },
      msgAnnotations: null,
    })
    expect(a).not.toBe(b)
  })

  it('changes when msgAnnotations changes', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: {
        inc: { intent: 'A', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
      },
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: {
        inc: { intent: 'B', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
      },
    })
    expect(a).not.toBe(b)
  })

  it('treats null and undefined msgAnnotations as equivalent', () => {
    const a = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: null,
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: undefined,
    })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/schema-hash.test.ts
```

Expected: FAIL (module not found).

---

## Task 7: Implement `computeSchemaHash`

**Files:**

- Create: `packages/vite-plugin/src/schema-hash.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { createHash } from 'node:crypto'
import type { MessageAnnotations } from './msg-annotations.js'

export type SchemaHashInput = {
  msgSchema: unknown
  stateSchema: unknown
  msgAnnotations: Record<string, MessageAnnotations> | null | undefined
}

/**
 * Stable hex SHA-256 (first 32 chars) over a normalized JSON serialization
 * of msgSchema + stateSchema + msgAnnotations. Object key order is
 * normalized so equivalent inputs always produce equal hashes.
 *
 * Used by the runtime to detect when the browser-to-server `hello` frame
 * needs to re-send its schema payload (dev hot-reload).
 */
export function computeSchemaHash(input: SchemaHashInput): string {
  const normalized = {
    msgSchema: sortDeep(input.msgSchema),
    stateSchema: sortDeep(input.stateSchema),
    msgAnnotations: sortDeep(input.msgAnnotations ?? null),
  }
  const json = JSON.stringify(normalized)
  return createHash('sha256').update(json).digest('hex').slice(0, 32)
}

function sortDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortDeep)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortDeep(obj[k])
  }
  return out
}
```

- [ ] **Step 2: Run tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/schema-hash.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/vite-plugin/src/schema-hash.ts packages/vite-plugin/test/schema-hash.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): computeSchemaHash — stable SHA-256 over schemas

32-char hex digest over deep-sorted JSON of msgSchema + stateSchema +
msgAnnotations. Used by the runtime hello frame for schema-change
detection during dev hot-reload. See agent spec §12.3, §7.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 8: Failing integration test — transform emits `__schemaHash`

**Files:**

- Modify: `packages/vite-plugin/test/transform.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('Pass 2 — __schemaHash emission', () => {
  it('emits __schemaHash alongside __msgSchema', () => {
    const source = `
import { component } from '@llui/dom'

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
  view: ({ text }) => [text((s) => String(s.count))],
})
`
    const out = runTransform(source)
    expect(out).toMatch(/__schemaHash:\s*["'][0-9a-f]{32}["']/)
  })

  it('__schemaHash changes when msgSchema changes', () => {
    const a = runTransform(`
import { component } from '@llui/dom'
type State = { n: number }
type Msg = { type: 'a' }
export const X = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`)
    const b = runTransform(`
import { component } from '@llui/dom'
type State = { n: number }
type Msg = { type: 'a' } | { type: 'b' }
export const X = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`)
    const aHash = a.match(/__schemaHash:\s*["']([0-9a-f]{32})["']/)?.[1]
    const bHash = b.match(/__schemaHash:\s*["']([0-9a-f]{32})["']/)?.[1]
    expect(aHash).toBeDefined()
    expect(bHash).toBeDefined()
    expect(aHash).not.toBe(bHash)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__schemaHash"
```

Expected: FAIL.

---

## Task 9: Integrate `computeSchemaHash` into Pass 2

**Files:**

- Modify: `packages/vite-plugin/src/transform.ts`

- [ ] **Step 1: Import**

Add near the other extractor imports:

```ts
import { computeSchemaHash } from './schema-hash.js'
```

- [ ] **Step 2: Compute + inject after msgSchema/stateSchema/msgAnnotations are known**

Just after the code that computes `msgSchema`, `stateSchema`, and `msgAnnotations`, add:

```ts
const schemaHash = computeSchemaHash({
  msgSchema: msgSchema ?? null,
  stateSchema: stateSchema ?? null,
  msgAnnotations,
})
```

Then in the block that pushes new properties onto the component-config object literal (alongside `__msgSchema`, `__msgAnnotations`, etc.), add:

```ts
newProps.push(
  ts.factory.createPropertyAssignment('__schemaHash', ts.factory.createStringLiteral(schemaHash)),
)
```

- [ ] **Step 3: Run integration tests**

```bash
cd packages/vite-plugin && pnpm vitest run test/transform.test.ts -t "__schemaHash"
```

Expected: PASS.

- [ ] **Step 4: Run full vite-plugin test suite**

```bash
cd packages/vite-plugin && pnpm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/vite-plugin/src/transform.ts packages/vite-plugin/test/transform.test.ts
git commit -m "$(cat <<'COMMIT'
feat(vite-plugin): inject __schemaHash into component() calls

Pass 2 now emits a 32-char hex SHA-256 over msgSchema + stateSchema +
msgAnnotations as __schemaHash on the component record. Runtime uses
it to gate hello-frame re-sends during dev hot-reload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 10: Extend `LluiComponentDef` in `@llui/dom` with new fields

**Files:**

- Modify: `packages/dom/src/types.ts`

- [ ] **Step 1: Read current `LluiComponentDef`**

Open `packages/dom/src/types.ts`. Find the existing `LluiComponentDef` / component-definition type that already declares `__msgSchema`, `__stateSchema`, `__effectSchema`, `__dirty`, `__update`, `__componentMeta`. (Based on repository exploration, this is around line 85–130.)

- [ ] **Step 2: Add the two new optional fields**

In the SAME interface that carries `__msgSchema?: unknown`, add (adjacent to the existing compiler-emitted fields):

```ts
  /** Compiler-emitted; keyed by Msg discriminant → MessageAnnotations. See agent spec §5.1. */
  __msgAnnotations?: Record<string, {
    intent: string | null
    alwaysAffordable: boolean
    requiresConfirm: boolean
    humanOnly: boolean
  }>

  /** Compiler-emitted; 32-char hex SHA-256 of the combined schemas + annotations. See agent spec §12.3. */
  __schemaHash?: string
```

- [ ] **Step 3: Type-check the dom package**

```bash
cd packages/dom && pnpm check
```

Expected: exit 0.

- [ ] **Step 4: Type-check the whole workspace**

```bash
cd /Users/franco/projects/llui && pnpm turbo check
```

Expected: all green. (If any downstream package consumes `LluiComponentDef` and references now-additional fields, it's still additive — no breakage.)

- [ ] **Step 5: Commit**

```bash
git add packages/dom/src/types.ts
git commit -m "$(cat <<'COMMIT'
feat(dom): LluiComponentDef fields for __msgAnnotations + __schemaHash

Optional; emitted by the vite plugin when Msg variants carry JSDoc
annotations. Paves the way for the agent server's describe_app
response and hello-frame schema-change detection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 11: Full workspace verification

**Files:** none directly — a verification pass.

- [ ] **Step 1: Re-run the whole workspace**

From `/Users/franco/projects/llui`:

```bash
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

Expected: all pass. No regressions. The new annotation and hash fields appear in `packages/vite-plugin/dist/` exports and are available as `@llui/vite-plugin/dist/msg-annotations` (internal; not re-exported from the plugin entry).

- [ ] **Step 2: Spot-check an example**

From the `examples/todomvc/` directory:

```bash
cd examples/todomvc && pnpm build 2>&1 | head -30
```

Expected: build succeeds. If the todomvc Msg type has no JSDoc annotations, `__msgAnnotations` should NOT appear in compiled output — confirm with a grep:

```bash
grep -r '__msgAnnotations' examples/todomvc/dist 2>/dev/null | head -5
grep -r '__schemaHash' examples/todomvc/dist 2>/dev/null | head -5
```

Expected: no `__msgAnnotations` match (example has no annotations today); `__schemaHash` matches present (always emitted).

- [ ] **Step 3: No commit for this task** — it's verification only.

---

## Task 12: Commit the plan file

**Files:**

- Modify/Create: `docs/superpowers/plans/2026-04-20-llui-agent-02-vite-annotations.md` (this file)

- [ ] **Step 1: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-llui-agent-02-vite-annotations.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 2 vite-annotations — implementation plan document

Records the 12-task plan that drove JSDoc annotation extraction
and schema-hash emission in @llui/vite-plugin.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- `packages/vite-plugin/src/msg-annotations.ts` extracts `{intent, alwaysAffordable, requiresConfirm, humanOnly}` from Msg union JSDoc, returning `Record<string, MessageAnnotations> | null`.
- `packages/vite-plugin/src/schema-hash.ts` returns a 32-hex-char stable hash.
- The vite transform Pass 2 emits `__msgAnnotations` (when non-default) and `__schemaHash` (always) on every compiled `component({...})` call.
- `LluiComponentDef` in `@llui/dom` carries the two new optional fields.
- Workspace-wide `pnpm turbo build/check/lint/test` passes with `examples/todomvc` recompilation confirmed.

---

## Explicitly deferred (Plan 3)

- `__bindingDescriptors` emission — walking event-handler arrow functions to identify `send({type: ...})` call sites, producing a per-component array of `BindingDescriptor`. Requires additional TypeScript AST analysis of `view()` bodies. Spec §5.2, §12.2.
- Lint rules in `@llui/lint-idiomatic` for missing `@intent`, forbidden annotation combinations, and non-pattern event handlers. These land in the Plan 6 polish phase, not Plan 3.
- Any runtime changes to how bindings carry descriptor references. Those live in Plan 3 (alongside the binding-descriptor emission).
