import { describe, it, expect } from 'vitest'
import { collapsibleClasses } from '../../../src/styles/classes/collapsible'

describe('collapsibleClasses', () => {
  it('returns all part keys', () => {
    const cls = collapsibleClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('content')
  })

  it('uses medium/default defaults', () => {
    const cls = collapsibleClasses()
    expect(cls.root).toContain('border')
    expect(cls.trigger).toContain('px-4')
    expect(cls.content).toContain('px-4')
  })

  it('applies size sm', () => {
    const cls = collapsibleClasses({ size: 'sm' })
    expect(cls.trigger).toContain('text-sm')
    expect(cls.content).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = collapsibleClasses({ size: 'lg' })
    expect(cls.trigger).toContain('text-lg')
    expect(cls.content).toContain('text-lg')
  })

  it('applies ghost variant', () => {
    const cls = collapsibleClasses({ variant: 'ghost' })
    expect(cls.root).not.toContain('border')
  })
})
