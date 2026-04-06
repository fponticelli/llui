import { describe, it, expect } from 'vitest'
import { dateInputClasses } from '../../../src/styles/classes/date-input'

describe('dateInputClasses', () => {
  it('returns all part keys', () => {
    const cls = dateInputClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('clearTrigger')
    expect(cls).toHaveProperty('errorText')
  })

  it('uses medium defaults', () => {
    const cls = dateInputClasses()
    expect(cls.root).toContain('h-10')
  })

  it('applies size sm', () => {
    const cls = dateInputClasses({ size: 'sm' })
    expect(cls.root).toContain('h-8')
    expect(cls.root).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = dateInputClasses({ size: 'lg' })
    expect(cls.root).toContain('h-12')
    expect(cls.root).toContain('rounded-lg')
  })
})
