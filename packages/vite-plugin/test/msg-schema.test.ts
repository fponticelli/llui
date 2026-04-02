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
})
