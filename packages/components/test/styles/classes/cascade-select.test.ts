import { describe, it, expect } from 'vitest'
import { cascadeSelectClasses } from '../../../src/styles/classes/cascade-select'

describe('cascadeSelectClasses', () => {
  it('returns all part keys', () => {
    const cls = cascadeSelectClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('levelLabel')
    expect(cls).toHaveProperty('levelSelect')
    expect(cls).toHaveProperty('clearTrigger')
  })

  it('uses medium defaults', () => {
    const cls = cascadeSelectClasses()
    expect(cls.root).toContain('gap-2')
  })

  it('applies size sm', () => {
    const cls = cascadeSelectClasses({ size: 'sm' })
    expect(cls.root).toContain('text-sm')
    expect(cls.root).toContain('gap-1')
  })

  it('applies size lg', () => {
    const cls = cascadeSelectClasses({ size: 'lg' })
    expect(cls.root).toContain('text-lg')
    expect(cls.root).toContain('gap-3')
  })
})
