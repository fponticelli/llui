import { describe, it, expect } from 'vitest'
import { checkboxClasses } from '../../../src/styles/classes/checkbox'

describe('checkboxClasses', () => {
  it('returns all part keys', () => {
    const cls = checkboxClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('indicator')
    expect(cls).toHaveProperty('label')
  })

  it('uses medium/primary defaults', () => {
    const cls = checkboxClasses()
    expect(cls.root).toContain('w-5')
    expect(cls.root).toContain('h-5')
    expect(cls.root).toContain('bg-primary')
  })

  it('applies size sm', () => {
    const cls = checkboxClasses({ size: 'sm' })
    expect(cls.root).toContain('w-4')
    expect(cls.root).toContain('h-4')
  })

  it('applies size lg', () => {
    const cls = checkboxClasses({ size: 'lg' })
    expect(cls.root).toContain('w-6')
    expect(cls.root).toContain('h-6')
  })

  it('applies destructive colorScheme', () => {
    const cls = checkboxClasses({ colorScheme: 'destructive' })
    expect(cls.root).toContain('bg-destructive')
  })

  it('indicator and label are static', () => {
    const a = checkboxClasses({ size: 'sm' })
    const b = checkboxClasses({ size: 'lg' })
    expect(a.indicator).toBe(b.indicator)
    expect(a.label).toBe(b.label)
  })
})
