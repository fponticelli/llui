import { describe, it, expect } from 'vitest'
import { switchClasses } from '../../../src/styles/classes/switch'

describe('switchClasses', () => {
  it('returns all part keys', () => {
    const cls = switchClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('track')
    expect(cls).toHaveProperty('thumb')
    expect(cls).toHaveProperty('label')
  })

  it('uses medium/primary defaults', () => {
    const cls = switchClasses()
    expect(cls.root).toContain('gap-3')
    expect(cls.track).toContain('w-11')
    expect(cls.track).toContain('bg-primary')
    expect(cls.thumb).toContain('w-5')
  })

  it('applies size sm', () => {
    const cls = switchClasses({ size: 'sm' })
    expect(cls.root).toContain('gap-2')
    expect(cls.track).toContain('w-8')
    expect(cls.thumb).toContain('w-3')
  })

  it('applies size lg', () => {
    const cls = switchClasses({ size: 'lg' })
    expect(cls.root).toContain('gap-4')
    expect(cls.track).toContain('w-14')
    expect(cls.thumb).toContain('w-6')
  })

  it('applies destructive colorScheme', () => {
    const cls = switchClasses({ colorScheme: 'destructive' })
    expect(cls.track).toContain('bg-destructive')
    expect(cls.track).not.toContain('bg-primary')
  })

  it('label class is static', () => {
    const a = switchClasses({ size: 'sm' })
    const b = switchClasses({ size: 'lg' })
    expect(a.label).toBe(b.label)
  })
})
