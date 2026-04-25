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
    expect(a).toMatch(/^[0-9a-f]{16,}$/)
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
        inc: {
          intent: 'A',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
        },
      },
    })
    const b = computeSchemaHash({
      msgSchema: { discriminant: 'type', variants: { inc: {} } },
      stateSchema: {},
      msgAnnotations: {
        inc: {
          intent: 'B',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
        },
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
