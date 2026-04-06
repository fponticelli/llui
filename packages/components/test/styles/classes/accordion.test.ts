import { describe, it, expect } from 'vitest'
import { accordionClasses } from '../../../src/styles/classes/accordion'

describe('accordionClasses', () => {
  it('returns all part keys', () => {
    const cls = accordionClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('content')
  })

  it('uses medium/outline defaults', () => {
    const cls = accordionClasses()
    expect(cls.root).toContain('text-base')
    expect(cls.root).toContain('border')
    expect(cls.trigger).toContain('py-3')
    expect(cls.content).toContain('p-4')
  })

  it('applies size sm', () => {
    const cls = accordionClasses({ size: 'sm' })
    expect(cls.root).toContain('text-sm')
    expect(cls.trigger).toContain('py-2')
    expect(cls.content).toContain('p-3')
  })

  it('applies size lg', () => {
    const cls = accordionClasses({ size: 'lg' })
    expect(cls.root).toContain('text-lg')
    expect(cls.trigger).toContain('py-4')
    expect(cls.content).toContain('p-6')
  })

  it('applies filled variant', () => {
    const cls = accordionClasses({ variant: 'filled' })
    expect(cls.root).toContain('bg-surface-muted')
    expect(cls.root).not.toContain('border-border')
  })

  it('applies ghost variant', () => {
    const cls = accordionClasses({ variant: 'ghost' })
    expect(cls.root).not.toContain('border')
    expect(cls.root).not.toContain('bg-surface-muted')
  })

  it('item class is static', () => {
    const a = accordionClasses({ size: 'sm' })
    const b = accordionClasses({ size: 'lg' })
    expect(a.item).toBe(b.item)
  })
})
