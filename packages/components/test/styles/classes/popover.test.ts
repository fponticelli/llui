import { describe, it, expect } from 'vitest'
import { popoverClasses } from '../../../src/styles/classes/popover'

describe('popoverClasses', () => {
  it('returns all part keys', () => {
    const cls = popoverClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('title')
    expect(cls).toHaveProperty('description')
    expect(cls).toHaveProperty('arrow')
    expect(cls).toHaveProperty('closeTrigger')
  })

  it('uses medium defaults', () => {
    const cls = popoverClasses()
    expect(cls.content).toContain('max-w-sm')
  })

  it('applies size sm', () => {
    const cls = popoverClasses({ size: 'sm' })
    expect(cls.content).toContain('max-w-xs')
    expect(cls.content).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = popoverClasses({ size: 'lg' })
    expect(cls.content).toContain('max-w-md')
    expect(cls.content).toContain('text-lg')
  })

  it('static parts do not change with size', () => {
    const a = popoverClasses({ size: 'sm' })
    const b = popoverClasses({ size: 'lg' })
    expect(a.positioner).toBe(b.positioner)
    expect(a.title).toBe(b.title)
    expect(a.arrow).toBe(b.arrow)
    expect(a.closeTrigger).toBe(b.closeTrigger)
  })
})
