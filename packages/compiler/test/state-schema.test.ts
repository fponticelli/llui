import { describe, it, expect } from 'vitest'
import { extractStateSchema } from '../src/state-schema.js'

describe('extractStateSchema', () => {
  it('extracts a `type State = { … }` alias (existing)', () => {
    expect(extractStateSchema('type State = { count: number; label: string }')).toEqual({
      fields: { count: 'number', label: 'string' },
    })
  })

  it('extracts an `interface State { … }` declaration', () => {
    const src = 'interface State { count: number; name?: string; done: boolean }'
    expect(extractStateSchema(src)).toEqual({
      fields: {
        count: 'number',
        name: { kind: 'optional', of: 'string' },
        done: 'boolean',
      },
    })
  })

  it('resolves nested interface references', () => {
    const src = [
      'interface User { name: string; age: number }',
      'interface State { user: User; tags: string[] }',
    ].join('\n')
    expect(extractStateSchema(src)).toEqual({
      fields: {
        user: { kind: 'object', fields: { name: 'string', age: 'number' } },
        tags: { kind: 'array', of: 'string' },
      },
    })
  })

  it('mixes interface State with a `type` alias field', () => {
    const src = ['type Mode = "a" | "b"', 'interface State { mode: Mode; n: number }'].join('\n')
    expect(extractStateSchema(src)).toEqual({
      fields: { mode: { kind: 'enum', values: ['a', 'b'] }, n: 'number' },
    })
  })

  it('returns null when the type/interface is absent', () => {
    expect(extractStateSchema('const x = 1')).toBeNull()
  })
})
