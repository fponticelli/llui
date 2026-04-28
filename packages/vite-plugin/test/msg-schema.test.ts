import { describe, it, expect } from 'vitest'
import { extractMsgSchema } from '../src/msg-schema'

describe('extractMsgSchema', () => {
  it('extracts variants from a Msg type alias', () => {
    const src = `
      type Msg =
        | { type: 'inc' }
        | { type: 'dec' }
        | { type: 'setCount'; value: number }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        inc: {},
        dec: {},
        setCount: { value: 'number' },
      },
    })
  })

  it('handles string literal union fields', () => {
    const src = `
      type Msg =
        | { type: 'setFilter'; filter: 'all' | 'active' | 'completed' }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        setFilter: { filter: { enum: ['all', 'active', 'completed'] } },
      },
    })
  })

  it('handles boolean and string fields', () => {
    const src = `
      type Msg =
        | { type: 'update'; text: string; done: boolean }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        update: { text: 'string', done: 'boolean' },
      },
    })
  })

  it('returns null when no Msg type exists', () => {
    const src = `const x = 42`
    expect(extractMsgSchema(src)).toBeNull()
  })

  it('falls back to unknown for complex types', () => {
    const src = `
      type Msg =
        | { type: 'data'; payload: Record<string, unknown> }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        data: { payload: 'unknown' },
      },
    })
  })

  // ── Field-level annotations ────────────────────────────────────

  it('marks optional fields with {optional: true}', () => {
    // TypeScript's `?:` becomes `{optional: true}` in the rich form.
    // The agent reads this to distinguish "must provide" from "may
    // omit" at construction time.
    const src = `
      type Msg =
        | { type: 'save'; title: string; description?: string }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        save: {
          title: 'string',
          description: { type: 'string', optional: true },
        },
      },
    })
  })

  it('extracts @should("hint") JSDoc into priority + hint', () => {
    // `@should` borrows RFC 2119: optional but the LLM ought to fill
    // it in unless there's a specific reason not to. Pairs with a
    // freeform hint that should describe consequence ("without this,
    // X breaks"), not just function ("the source URL").
    const src = `
      type Msg =
        | {
            type: 'setMeta'
            criterionId: string
            /** @should("Cite where the value came from. Cells without provenance can't be defended later.") */
            source?: string
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema).toEqual({
      discriminant: 'type',
      variants: {
        setMeta: {
          criterionId: 'string',
          source: {
            type: 'string',
            optional: true,
            priority: 'should',
            hint: "Cite where the value came from. Cells without provenance can't be defended later.",
          },
        },
      },
    })
  })

  it('keeps the bare form when no annotations are present', () => {
    // Required fields with no JSDoc emit as bare types, not rich
    // descriptors — keeps the bundle small for the typical case
    // where most fields aren't annotated.
    const src = `
      type Msg =
        | { type: 'inc'; by: number }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.inc?.by).toBe('number')
  })

  it('handles @should on required (non-optional) fields', () => {
    // `@should` on a required field is unusual but valid — TS-required
    // means "must provide", and the hint tells the LLM what to put
    // there. No `optional: true` flag emitted.
    const src = `
      type Msg =
        | {
            type: 'note'
            /** @should("A short, factual description of the change.") */
            text: string
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.note?.text).toEqual({
      type: 'string',
      priority: 'should',
      hint: 'A short, factual description of the change.',
    })
  })

  it('tolerates curly quotes in @should (autocorrect-friendly)', () => {
    // Editors that auto-replace " with “ ” shouldn't break the parser.
    const src = `
      type Msg =
        | {
            type: 'x'
            /** @should(“fancy quotes”) */
            field?: string
          }
    `
    const schema = extractMsgSchema(src)
    const f = schema?.variants.x?.field
    expect(f).toMatchObject({ hint: 'fancy quotes' })
  })

  it('extracts @should from multi-line JSDoc on readonly properties', () => {
    // Real-world apps tend to write JSDoc like this — block comment
    // wrapping a long @should hint, with `readonly` modifiers on
    // property signatures. The parser must read the leading comment
    // range before the `readonly` token, not just the property name.
    const src = `
      type Msg =
        | {
            readonly type: 'Add'
            /**
             * @should("Cite where the value came from.")
             */
            readonly items: readonly string[]
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.Add?.items).toMatchObject({
      priority: 'should',
      hint: 'Cite where the value came from.',
    })
  })

  // ── Deep type resolution ───────────────────────────────────────

  it('follows local interface references into nested object shapes', () => {
    // Real motivating case from decisive.space-2: Msg fields
    // referencing app-defined interfaces like Criterion. Without
    // recursion these collapsed to 'unknown'; the LLM had to guess
    // at the shape from external docs. Now the synthesizer sees a
    // copy-paste-ready skeleton.
    const src = `
      interface Criterion {
        id: string
        title: string
        weight: number
      }
      type Msg =
        | { type: 'AddCriterion'; criterion: Criterion }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.AddCriterion?.criterion).toEqual({
      kind: 'object',
      shape: {
        id: 'string',
        title: 'string',
        weight: 'number',
      },
    })
  })

  it('follows local type aliases the same way as interfaces', () => {
    const src = `
      type Coord = { x: number; y: number }
      type Msg =
        | { type: 'Move'; from: Coord; to: Coord }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.Move?.from).toMatchObject({
      kind: 'object',
      shape: { x: 'number', y: 'number' },
    })
  })

  it('handles array types — T[], readonly T[], Array<T>, ReadonlyArray<T>', () => {
    const src = `
      interface Item { id: string }
      type Msg =
        | { type: 'A'; items: Item[] }
        | { type: 'B'; items: readonly Item[] }
        | { type: 'C'; items: Array<Item> }
        | { type: 'D'; items: ReadonlyArray<Item> }
    `
    const schema = extractMsgSchema(src)
    const expected = {
      kind: 'array',
      element: { kind: 'object', shape: { id: 'string' } },
    }
    expect(schema?.variants.A?.items).toEqual(expected)
    expect(schema?.variants.B?.items).toEqual(expected)
    expect(schema?.variants.C?.items).toEqual(expected)
    expect(schema?.variants.D?.items).toEqual(expected)
  })

  it('emits inline object literal types directly', () => {
    // No type alias indirection — the literal is the type.
    const src = `
      type Msg =
        | { type: 'Set'; pos: { x: number; y: number } }
    `
    expect(extractMsgSchema(src)?.variants.Set?.pos).toEqual({
      kind: 'object',
      shape: { x: 'number', y: 'number' },
    })
  })

  it('caps depth — stops recursion at MAX_FIELD_DEPTH', () => {
    // Self-referential types like a tree node would otherwise spiral.
    // The cap (3) means the agent sees up to a few levels of shape
    // before falling back to 'unknown'. Test passes if extraction
    // completes (no stack overflow) and produces some shape.
    const src = `
      interface Node { id: string; children: Node[] }
      type Msg = | { type: 'Add'; root: Node }
    `
    const schema = extractMsgSchema(src)
    // Outer object shape resolved; inner children collapse to
    // 'unknown' once depth runs out.
    const outer = schema?.variants.Add?.root
    expect(outer).toMatchObject({ kind: 'object' })
    expect(JSON.stringify(outer)).toContain('"id":"string"')
  })

  it('cross-file references stay unknown (no module resolution)', () => {
    // Type imported from another file isn't in the local index.
    // Falls back to 'unknown' rather than fabricating a shape — the
    // cross-file resolver pipeline handles top-level Msg unions, but
    // not nested type references.
    const src = `
      import type { Criterion } from '@decisive/domain'
      type Msg = | { type: 'X'; criterion: Criterion }
    `
    expect(extractMsgSchema(src)?.variants.X?.criterion).toBe('unknown')
  })

  // ── Discriminated unions of objects ────────────────────────────

  it('extracts a discriminated union of inline object literals', () => {
    // The motivating case from decisive.space-2: a Criterion's `format`
    // field is `{kind: 'exact'} | {kind: 'range', min: number, max: number}`.
    // Without this, the field collapses to 'unknown' and the LLM has
    // to guess at the shape. With it, the schema enumerates exactly
    // which `kind` values are legal and what payload each branch needs.
    const src = `
      type Msg =
        | {
            type: 'SetFormat'
            format:
              | { kind: 'exact' }
              | { kind: 'range'; min: number; max: number }
              | { kind: 'compound'; formula: string }
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.SetFormat?.format).toEqual({
      kind: 'discriminated-union',
      discriminant: 'kind',
      variants: {
        exact: {},
        range: { min: 'number', max: 'number' },
        compound: { formula: 'string' },
      },
    })
  })

  it('extracts a discriminated union via type alias references', () => {
    // Real apps often factor each branch into its own named type.
    // The resolver must follow the named references through the index
    // and reconstruct the union with each branch's resolved shape.
    const src = `
      type ExactFormat = { kind: 'exact' }
      type RangeFormat = { kind: 'range'; min: number; max: number }
      type Format = ExactFormat | RangeFormat
      type Msg =
        | { type: 'SetFormat'; format: Format }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.SetFormat?.format).toEqual({
      kind: 'discriminated-union',
      discriminant: 'kind',
      variants: {
        exact: {},
        range: { min: 'number', max: 'number' },
      },
    })
  })

  it('falls back to unknown when union members do not share a discriminant', () => {
    // A | B where the literal-string keys differ — e.g. {kind:'a'} | {tag:'b'}.
    // Not a discriminated union in the recognised sense; bail rather than
    // fabricate a shape the LLM might trust.
    const src = `
      type Msg =
        | {
            type: 'X'
            payload: { kind: 'a'; x: number } | { tag: 'b'; y: string }
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.payload).toBe('unknown')
  })

  it('falls back to unknown when union mixes primitives and objects', () => {
    // string | { ... } isn't a discriminated union of objects.
    const src = `
      type Msg =
        | { type: 'X'; payload: string | { kind: 'b'; y: number } }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.payload).toBe('unknown')
  })

  // ── Branded primitives ─────────────────────────────────────────

  it('extracts a branded string as the base primitive', () => {
    // `type UID = string & {__brand: 'UID'}` is the canonical brand
    // shape. The brand tag is TS-only; runtime values are just strings.
    // Schema records `'string'` so the validator's typeof check passes
    // for any string value.
    const src = `
      type UID = string & { __brand: 'UID' }
      type Msg = | { type: 'X'; id: UID }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.id).toBe('string')
  })

  it('extracts a branded number as number', () => {
    const src = `
      type Cents = number & { __brand: 'Cents' }
      type Msg = | { type: 'X'; price: Cents }
    `
    expect(extractMsgSchema(src)?.variants.X?.price).toBe('number')
  })

  it('extracts a branded type with readonly modifier', () => {
    // The readonly form is common in lockdown-heavy codebases.
    const src = `
      type UID = string & { readonly __brand: 'UID' }
      type Msg = | { type: 'X'; id: UID }
    `
    expect(extractMsgSchema(src)?.variants.X?.id).toBe('string')
  })

  it('rejects intersections that mix in real fields (not brands)', () => {
    // `string & {field: number}` isn't a brand — it's a constructive
    // intersection. We don't try to model that; bail to 'unknown'.
    const src = `
      type Weird = string & { field: number }
      type Msg = | { type: 'X'; payload: Weird }
    `
    expect(extractMsgSchema(src)?.variants.X?.payload).toBe('unknown')
  })

  it('rejects intersections without a primitive base', () => {
    // `{__brand:'A'} & {__brand:'B'}` — no underlying primitive to
    // unwrap to. Bail rather than guess.
    const src = `
      type AB = { __brand: 'A' } & { __brand: 'B' }
      type Msg = | { type: 'X'; payload: AB }
    `
    expect(extractMsgSchema(src)?.variants.X?.payload).toBe('unknown')
  })

  // ── Number / boolean literal unions ────────────────────────────

  it('handles number-literal unions as enum', () => {
    // 1 | 2 | 3 | 4 | 5 (a rating scale). Currently collapses to
    // 'unknown' because the union-handler only recognises string
    // literals. The fix accepts numeric literals too.
    const src = `
      type Msg =
        | { type: 'SetRating'; value: 1 | 2 | 3 | 4 | 5 }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.SetRating?.value).toEqual({ enum: [1, 2, 3, 4, 5] })
  })

  it('handles boolean-literal unions as enum', () => {
    // true | false is rare (just use boolean), but `false` alone or
    // `true` alone as a literal type should still surface as enum.
    const src = `
      type Msg =
        | { type: 'X'; flag: true }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.flag).toEqual({ enum: [true] })
  })

  // ── Depth ────────────────────────────────────────────────────────

  it('resolves four-level nesting (depth 5)', () => {
    // Real Msg payloads in non-toy apps reach 4–5 levels:
    //   Matrix/AddCriteria.criteria[].format.kind
    // The previous depth cap of 3 collapsed `format` to unknown. With
    // depth 5, the inner shape is fully resolved.
    const src = `
      interface Format { kind: 'exact' | 'range' }
      interface Criterion { id: string; format: Format }
      type Msg =
        | { type: 'AddCriteria'; criteria: Criterion[] }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.AddCriteria?.criteria).toEqual({
      kind: 'array',
      element: {
        kind: 'object',
        shape: {
          id: 'string',
          format: {
            kind: 'object',
            shape: {
              kind: { enum: ['exact', 'range'] },
            },
          },
        },
      },
    })
  })

  // ── @validates predicate ───────────────────────────────────────

  it('extracts @validates JSDoc into the rich descriptor', () => {
    // The motivating use: domain invariants TypeScript can't express
    // (numeric ranges, format predicates, length bounds). The compiler
    // captures the predicate verbatim; the runtime validator compiles
    // it lazily with `new Function('v', 'return (' + src + ')')`.
    const src = `
      type Msg =
        | {
            type: 'SetWeight'
            /** @validates("v >= 0 && v <= 100") */
            weight: number
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.SetWeight?.weight).toEqual({
      type: 'number',
      validates: 'v >= 0 && v <= 100',
    })
  })

  it('combines @validates with @should and optional', () => {
    // All three rich-descriptor signals on a single field — exercises
    // the producer's emit path for the kitchen-sink case.
    const src = `
      type Msg =
        | {
            type: 'X'
            /**
             * @should("Cite the source.")
             * @validates("v.length > 0")
             */
            url?: string
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.url).toEqual({
      type: 'string',
      optional: true,
      priority: 'should',
      hint: 'Cite the source.',
      validates: 'v.length > 0',
    })
  })

  it('preserves enum types inside rich descriptors', () => {
    const src = `
      type Msg =
        | {
            type: 'setSharing'
            /** @should("Defaults to private. Public is indexable; unlisted is link-only.") */
            sharing?: 'private' | 'unlisted' | 'public'
          }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.setSharing?.sharing).toEqual({
      type: { enum: ['private', 'unlisted', 'public'] },
      optional: true,
      priority: 'should',
      hint: 'Defaults to private. Public is indexable; unlisted is link-only.',
    })
  })

  // ── T | undefined → optional T ─────────────────────────────────
  // Decisive (and many older codebases) declares fields as
  // `field: T | undefined` rather than `field?: T`. Semantically the
  // two are identical at runtime; structurally the schema extractor
  // used to emit the former as required+unknown (the union doesn't
  // match literal-enum or discriminated-union patterns), forcing
  // agents to spell out `field: undefined` literally on every
  // payload. We strip the `undefined` branch and treat the field as
  // optional with the remaining branch's type.

  it('treats `T | undefined` as optional T', () => {
    const src = `
      type Msg =
        | { type: 'X'; details: string | undefined }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.details).toEqual({ type: 'string', optional: true })
  })

  it('treats `undefined | T` (reversed order) the same way', () => {
    const src = `
      type Msg =
        | { type: 'X'; details: undefined | string }
    `
    const schema = extractMsgSchema(src)
    expect(schema?.variants.X?.details).toEqual({ type: 'string', optional: true })
  })

  it('treats `number | undefined` as optional number', () => {
    const src = `
      type Msg =
        | { type: 'X'; count: number | undefined }
    `
    expect(extractMsgSchema(src)?.variants.X?.count).toEqual({ type: 'number', optional: true })
  })

  it('treats `boolean | undefined` as optional boolean', () => {
    const src = `
      type Msg =
        | { type: 'X'; flag: boolean | undefined }
    `
    expect(extractMsgSchema(src)?.variants.X?.flag).toEqual({ type: 'boolean', optional: true })
  })

  it('preserves the literal-enum width when stripping `| undefined`', () => {
    // A field declared as 'a' | 'b' | undefined should resolve to an
    // optional enum, not collapse to an optional 'a' or to unknown.
    const src = `
      type Msg =
        | { type: 'X'; mode: 'a' | 'b' | undefined }
    `
    expect(extractMsgSchema(src)?.variants.X?.mode).toEqual({
      type: { enum: ['a', 'b'] },
      optional: true,
    })
  })

  it('preserves an explicit `?:` modifier when the type is also `T | undefined`', () => {
    // `field?: T | undefined` is what TypeScript actually generates
    // from `field?: T` under strict-null. Both should produce the same
    // shape: optional with type T, no doubled annotation.
    const src = `
      type Msg =
        | { type: 'X'; details?: string | undefined }
    `
    expect(extractMsgSchema(src)?.variants.X?.details).toEqual({ type: 'string', optional: true })
  })

  it('does NOT treat `T | null` as optional (null is a real value)', () => {
    // `null` is a legal payload value that the agent might send to
    // explicitly clear the field. We only strip `undefined` because
    // it isn't JSON-serializable and stripping it preserves
    // round-trip behavior.
    const src = `
      type Msg =
        | { type: 'X'; details: string | null }
    `
    // Falls through to unknown — the union is neither a pure literal
    // enum nor a discriminable object union. (We don't need to make
    // T | null resolve to T; the explicit null is meaningful.)
    expect(extractMsgSchema(src)?.variants.X?.details).toBe('unknown')
  })

  // ── Depth model — inline structural traversal doesn't cost depth ─

  it('resolves a discriminated-union field nested under array+object+DU+object+named (5+ inline hops)', () => {
    // Mirrors Matrix/AddCriteria.criteria[].type(quantity).clamp in
    // decisive: every structural wrapper used to consume a unit of
    // depth budget, so the inner Clamp DU (one named-type hop past
    // the budget ceiling) collapsed to 'unknown'. With the new model
    // only NAMED-TYPE lookups decrement depth, so the inline path
    // through array→object→DU→variant→object→named-Clamp→DU resolves.
    const src = `
      type Clamp = { kind: 'unclamped' } | { kind: 'clamped' }
      interface Criterion {
        id: string
        type: { kind: 'quantity'; clamp: Clamp } | { kind: 'rating'; stars: number }
      }
      type Msg =
        | { type: 'AddCriteria'; criteria: Criterion[] }
    `
    const schema = extractMsgSchema(src)
    const criteria = schema?.variants.AddCriteria?.criteria
    expect(criteria).toMatchObject({ kind: 'array' })
    const element = (criteria as { kind: 'array'; element: unknown }).element
    expect(element).toMatchObject({ kind: 'object' })
    // Walk to the clamp field inside the quantity variant.
    const elementShape = (element as { shape: Record<string, unknown> }).shape
    const typeField = elementShape.type as {
      kind: 'discriminated-union'
      variants: Record<string, Record<string, unknown>>
    }
    expect(typeField.kind).toBe('discriminated-union')
    const quantityVariant = typeField.variants.quantity
    expect(quantityVariant?.clamp).toEqual({
      kind: 'discriminated-union',
      discriminant: 'kind',
      variants: { unclamped: {}, clamped: {} },
    })
  })

  it('still terminates on self-referential types (Node tree)', () => {
    // Cycle detection still works: each named-type lookup decrements
    // the budget, so deeply-recursive `Node.children: Node[]` chains
    // bottom out at 'unknown' without stack-overflowing.
    const src = `
      interface Node { id: string; children: Node[] }
      type Msg = | { type: 'Add'; root: Node }
    `
    const schema = extractMsgSchema(src)
    const outer = schema?.variants.Add?.root
    expect(outer).toMatchObject({ kind: 'object' })
    // Extraction completes — no stack overflow, some shape produced.
    expect(JSON.stringify(outer)).toContain('"id":"string"')
  })
})
