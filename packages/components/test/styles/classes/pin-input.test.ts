import { describe, it, expect } from 'vitest'
import { pinInputClasses } from '../../../src/styles/classes/pin-input'

describe('pinInputClasses', () => {
  it('returns all part keys', () => {
    const cls = pinInputClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('label')
    expect(cls).toHaveProperty('input')
  })

  it('uses medium defaults', () => {
    const cls = pinInputClasses()
    expect(cls.input).toContain('w-10')
    expect(cls.input).toContain('h-10')
  })

  it('applies size sm', () => {
    const cls = pinInputClasses({ size: 'sm' })
    expect(cls.input).toContain('w-8')
    expect(cls.input).toContain('h-8')
  })

  it('applies size lg', () => {
    const cls = pinInputClasses({ size: 'lg' })
    expect(cls.input).toContain('w-12')
    expect(cls.input).toContain('h-12')
  })

  it('root and label are static', () => {
    const a = pinInputClasses({ size: 'sm' })
    const b = pinInputClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.label).toBe(b.label)
  })
})
