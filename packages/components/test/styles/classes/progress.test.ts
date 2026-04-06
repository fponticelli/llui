import { describe, it, expect } from 'vitest'
import { progressClasses } from '../../../src/styles/classes/progress'

describe('progressClasses', () => {
  it('returns all part keys', () => {
    const cls = progressClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('track')
    expect(cls).toHaveProperty('range')
    expect(cls).toHaveProperty('label')
  })

  it('uses medium/primary defaults', () => {
    const cls = progressClasses()
    expect(cls.track).toContain('h-2.5')
    expect(cls.range).toContain('bg-primary')
  })

  it('applies size sm', () => {
    const cls = progressClasses({ size: 'sm' })
    expect(cls.track).toContain('h-1.5')
  })

  it('applies size lg', () => {
    const cls = progressClasses({ size: 'lg' })
    expect(cls.track).toContain('h-4')
  })

  it('applies destructive colorScheme', () => {
    const cls = progressClasses({ colorScheme: 'destructive' })
    expect(cls.range).toContain('bg-destructive')
  })

  it('label is static', () => {
    const a = progressClasses({ size: 'sm' })
    const b = progressClasses({ size: 'lg' })
    expect(a.label).toBe(b.label)
  })
})
