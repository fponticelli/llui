import { describe, it, expect, beforeEach } from 'vitest'
import { anatomy, resetAnatomyIdCounter } from '../../src/utils/anatomy'

describe('anatomy()', () => {
  beforeEach(() => resetAnatomyIdCounter())

  it('exposes name and parts', () => {
    const a = anatomy('dialog', ['trigger', 'content'] as const)
    expect(a.name).toBe('dialog')
    expect(a.parts).toEqual(['trigger', 'content'])
  })

  it('generates unique ids per scope', () => {
    const a = anatomy('dialog', ['trigger'] as const)
    const s1 = a.scope()
    const s2 = a.scope()
    expect(s1.id).not.toBe(s2.id)
    expect(s1.id).toBe('dialog-1')
    expect(s2.id).toBe('dialog-2')
  })

  it('accepts explicit ids (for SSR)', () => {
    const a = anatomy('menu', ['item'] as const)
    const s = a.scope('my-menu')
    expect(s.id).toBe('my-menu')
    expect(s.idFor('item')).toBe('my-menu:item')
  })

  it('idFor composes scope + part', () => {
    const a = anatomy('tabs', ['tab', 'panel'] as const)
    const s = a.scope('t1')
    expect(s.idFor('tab')).toBe('t1:tab')
    expect(s.idFor('panel')).toBe('t1:panel')
  })

  it('attrs produces data-scope + data-part + id', () => {
    const a = anatomy('dialog', ['content'] as const)
    const s = a.scope('d1')
    expect(s.attrs('content')).toEqual({
      id: 'd1:content',
      'data-scope': 'dialog',
      'data-part': 'content',
    })
  })
})
