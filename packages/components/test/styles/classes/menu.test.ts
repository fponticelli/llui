import { describe, it, expect } from 'vitest'
import { menuClasses } from '../../../src/styles/classes/menu'

describe('menuClasses', () => {
  it('returns all part keys', () => {
    const cls = menuClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('item')
  })

  it('uses medium/default defaults', () => {
    const cls = menuClasses()
    expect(cls.content).toContain('min-w-40')
    expect(cls.item).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = menuClasses({ size: 'sm' })
    expect(cls.content).toContain('min-w-32')
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = menuClasses({ size: 'lg' })
    expect(cls.content).toContain('rounded-lg')
    expect(cls.item).toContain('text-lg')
  })

  it('applies destructive variant', () => {
    const cls = menuClasses({ variant: 'destructive' })
    expect(cls.item).toContain('text-destructive')
  })

  it('static parts do not change', () => {
    const a = menuClasses({ size: 'sm' })
    const b = menuClasses({ size: 'lg' })
    expect(a.positioner).toBe(b.positioner)
  })
})
