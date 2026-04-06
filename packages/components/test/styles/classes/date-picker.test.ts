import { describe, it, expect } from 'vitest'
import { datePickerClasses } from '../../../src/styles/classes/date-picker'

describe('datePickerClasses', () => {
  it('returns all part keys', () => {
    const cls = datePickerClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('grid')
    expect(cls).toHaveProperty('dayCell')
    expect(cls).toHaveProperty('prevMonthTrigger')
    expect(cls).toHaveProperty('nextMonthTrigger')
  })

  it('uses medium defaults', () => {
    const cls = datePickerClasses()
    expect(cls.root).toContain('rounded-lg')
    expect(cls.root).toContain('p-3')
    expect(cls.dayCell).toContain('w-9')
  })

  it('applies size sm', () => {
    const cls = datePickerClasses({ size: 'sm' })
    expect(cls.root).toContain('text-sm')
    expect(cls.dayCell).toContain('w-7')
  })

  it('applies size lg', () => {
    const cls = datePickerClasses({ size: 'lg' })
    expect(cls.root).toContain('text-lg')
    expect(cls.dayCell).toContain('w-11')
  })

  it('static parts do not change', () => {
    const a = datePickerClasses({ size: 'sm' })
    const b = datePickerClasses({ size: 'lg' })
    expect(a.grid).toBe(b.grid)
    expect(a.prevMonthTrigger).toBe(b.prevMonthTrigger)
  })
})
