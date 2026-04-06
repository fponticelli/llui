import { describe, it, expect } from 'vitest'
import { toggleClasses } from '../../../src/styles/classes/toggle'

describe('toggleClasses', () => {
  it('returns root key', () => {
    const cls = toggleClasses()
    expect(cls).toHaveProperty('root')
  })

  it('uses medium/outline defaults', () => {
    const cls = toggleClasses()
    expect(cls.root).toContain('p-2')
    expect(cls.root).toContain('border-border')
  })

  it('applies size sm', () => {
    const cls = toggleClasses({ size: 'sm' })
    expect(cls.root).toContain('p-1.5')
    expect(cls.root).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = toggleClasses({ size: 'lg' })
    expect(cls.root).toContain('p-3')
    expect(cls.root).toContain('text-lg')
  })

  it('applies ghost variant', () => {
    const cls = toggleClasses({ variant: 'ghost' })
    expect(cls.root).toContain('border-transparent')
  })
})
