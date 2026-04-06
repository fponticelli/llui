import { describe, it, expect } from 'vitest'
import { numberInputClasses } from '../../../src/styles/classes/number-input'

describe('numberInputClasses', () => {
  it('returns all part keys', () => {
    const cls = numberInputClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('increment')
    expect(cls).toHaveProperty('decrement')
  })

  it('uses medium defaults', () => {
    const cls = numberInputClasses()
    expect(cls.root).toContain('h-10')
    expect(cls.input).toContain('px-3')
    expect(cls.increment).toContain('w-10')
  })

  it('applies size sm', () => {
    const cls = numberInputClasses({ size: 'sm' })
    expect(cls.root).toContain('h-8')
    expect(cls.input).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = numberInputClasses({ size: 'lg' })
    expect(cls.root).toContain('h-12')
    expect(cls.root).toContain('rounded-lg')
  })
})
