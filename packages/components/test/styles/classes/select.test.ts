import { describe, it, expect } from 'vitest'
import { selectClasses } from '../../../src/styles/classes/select'

describe('selectClasses', () => {
  it('returns all part keys', () => {
    const cls = selectClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('hiddenSelect')
  })

  it('uses medium defaults', () => {
    const cls = selectClasses()
    expect(cls.trigger).toContain('px-3')
    expect(cls.trigger).toContain('py-2')
    expect(cls.content).toContain('rounded-md')
    expect(cls.item).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = selectClasses({ size: 'sm' })
    expect(cls.trigger).toContain('text-sm')
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = selectClasses({ size: 'lg' })
    expect(cls.trigger).toContain('text-lg')
    expect(cls.content).toContain('rounded-lg')
  })

  it('static parts do not change with size', () => {
    const a = selectClasses({ size: 'sm' })
    const b = selectClasses({ size: 'lg' })
    expect(a.positioner).toBe(b.positioner)
    expect(a.hiddenSelect).toBe(b.hiddenSelect)
  })
})
