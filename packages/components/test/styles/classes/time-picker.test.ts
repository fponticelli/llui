import { describe, it, expect } from 'vitest'
import { timePickerClasses } from '../../../src/styles/classes/time-picker'

describe('timePickerClasses', () => {
  it('returns all part keys', () => {
    const cls = timePickerClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('hoursInput')
    expect(cls).toHaveProperty('minutesInput')
    expect(cls).toHaveProperty('periodTrigger')
  })

  it('uses medium defaults', () => {
    const cls = timePickerClasses()
    expect(cls.root).toContain('h-10')
    expect(cls.root).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = timePickerClasses({ size: 'sm' })
    expect(cls.root).toContain('h-8')
    expect(cls.root).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = timePickerClasses({ size: 'lg' })
    expect(cls.root).toContain('h-12')
    expect(cls.root).toContain('rounded-lg')
  })

  it('static parts do not change', () => {
    const a = timePickerClasses({ size: 'sm' })
    const b = timePickerClasses({ size: 'lg' })
    expect(a.hoursInput).toBe(b.hoursInput)
    expect(a.minutesInput).toBe(b.minutesInput)
    expect(a.periodTrigger).toBe(b.periodTrigger)
  })
})
