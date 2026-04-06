import { describe, it, expect } from 'vitest'
import { comboboxClasses } from '../../../src/styles/classes/combobox'

describe('comboboxClasses', () => {
  it('returns all part keys', () => {
    const cls = comboboxClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('empty')
  })

  it('uses medium defaults', () => {
    const cls = comboboxClasses()
    expect(cls.input).toContain('px-3')
    expect(cls.input).toContain('py-2')
    expect(cls.content).toContain('rounded-md')
    expect(cls.item).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = comboboxClasses({ size: 'sm' })
    expect(cls.input).toContain('text-sm')
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = comboboxClasses({ size: 'lg' })
    expect(cls.input).toContain('text-lg')
    expect(cls.content).toContain('rounded-lg')
  })

  it('static parts do not change with size', () => {
    const a = comboboxClasses({ size: 'sm' })
    const b = comboboxClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.trigger).toBe(b.trigger)
    expect(a.positioner).toBe(b.positioner)
    expect(a.empty).toBe(b.empty)
  })
})
