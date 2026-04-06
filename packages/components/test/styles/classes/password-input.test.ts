import { describe, it, expect } from 'vitest'
import { passwordInputClasses } from '../../../src/styles/classes/password-input'

describe('passwordInputClasses', () => {
  it('returns all part keys', () => {
    const cls = passwordInputClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('visibilityTrigger')
  })

  it('uses medium defaults', () => {
    const cls = passwordInputClasses()
    expect(cls.root).toContain('h-10')
    expect(cls.input).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = passwordInputClasses({ size: 'sm' })
    expect(cls.root).toContain('h-8')
    expect(cls.input).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = passwordInputClasses({ size: 'lg' })
    expect(cls.root).toContain('h-12')
    expect(cls.root).toContain('rounded-lg')
  })

  it('visibility trigger is static', () => {
    const a = passwordInputClasses({ size: 'sm' })
    const b = passwordInputClasses({ size: 'lg' })
    expect(a.visibilityTrigger).toBe(b.visibilityTrigger)
  })
})
