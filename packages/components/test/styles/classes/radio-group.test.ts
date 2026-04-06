import { describe, it, expect } from 'vitest'
import { radioGroupClasses } from '../../../src/styles/classes/radio-group'

describe('radioGroupClasses', () => {
  it('returns all part keys', () => {
    const cls = radioGroupClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('control')
    expect(cls).toHaveProperty('indicator')
    expect(cls).toHaveProperty('label')
  })

  it('uses medium/primary defaults', () => {
    const cls = radioGroupClasses()
    expect(cls.control).toContain('w-5')
    expect(cls.control).toContain('h-5')
    expect(cls.indicator).toContain('w-2.5')
    expect(cls.indicator).toContain('bg-primary')
  })

  it('applies size sm', () => {
    const cls = radioGroupClasses({ size: 'sm' })
    expect(cls.control).toContain('w-4')
    expect(cls.indicator).toContain('w-2')
  })

  it('applies size lg', () => {
    const cls = radioGroupClasses({ size: 'lg' })
    expect(cls.control).toContain('w-6')
    expect(cls.indicator).toContain('w-3')
  })

  it('applies destructive colorScheme', () => {
    const cls = radioGroupClasses({ colorScheme: 'destructive' })
    expect(cls.control).toContain('border-destructive')
    expect(cls.indicator).toContain('bg-destructive')
  })

  it('static parts do not change with variants', () => {
    const a = radioGroupClasses({ size: 'sm' })
    const b = radioGroupClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.item).toBe(b.item)
    expect(a.label).toBe(b.label)
  })
})
