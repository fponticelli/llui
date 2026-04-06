import { describe, it, expect } from 'vitest'
import { tabsClasses } from '../../../src/styles/classes/tabs'

describe('tabsClasses', () => {
  it('returns all part keys', () => {
    const cls = tabsClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('list')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('panel')
    expect(cls).toHaveProperty('indicator')
  })

  it('uses medium/underline defaults', () => {
    const cls = tabsClasses()
    expect(cls.list).toContain('border-b')
    expect(cls.trigger).toContain('px-4')
    expect(cls.trigger).toContain('py-2')
    expect(cls.trigger).toContain('border-b-2')
    expect(cls.panel).toContain('p-4')
  })

  it('applies size sm', () => {
    const cls = tabsClasses({ size: 'sm' })
    expect(cls.trigger).toContain('px-3')
    expect(cls.trigger).toContain('text-sm')
    expect(cls.panel).toContain('p-3')
  })

  it('applies size lg', () => {
    const cls = tabsClasses({ size: 'lg' })
    expect(cls.trigger).toContain('px-6')
    expect(cls.trigger).toContain('text-lg')
    expect(cls.panel).toContain('p-6')
  })

  it('applies pill variant', () => {
    const cls = tabsClasses({ variant: 'pill' })
    expect(cls.list).toContain('bg-surface-muted')
    expect(cls.list).toContain('rounded-lg')
    expect(cls.trigger).toContain('data-[state=active]:shadow-sm')
  })

  it('applies outline variant', () => {
    const cls = tabsClasses({ variant: 'outline' })
    expect(cls.trigger).toContain('rounded-md')
    expect(cls.trigger).toContain('data-[state=active]:border-border')
  })

  it('root and indicator are static', () => {
    const a = tabsClasses({ size: 'sm', variant: 'pill' })
    const b = tabsClasses({ size: 'lg', variant: 'underline' })
    expect(a.root).toBe(b.root)
    expect(a.indicator).toBe(b.indicator)
  })
})
