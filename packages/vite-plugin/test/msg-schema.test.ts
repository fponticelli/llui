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
})
