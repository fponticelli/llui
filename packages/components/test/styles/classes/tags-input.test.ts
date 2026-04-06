import { describe, it, expect } from 'vitest'
import { tagsInputClasses } from '../../../src/styles/classes/tags-input'

describe('tagsInputClasses', () => {
  it('returns all part keys', () => {
    const cls = tagsInputClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('tag')
    expect(cls).toHaveProperty('tagRemove')
    expect(cls).toHaveProperty('clearTrigger')
  })

  it('uses medium defaults', () => {
    const cls = tagsInputClasses()
    expect(cls.root).toContain('px-3')
    expect(cls.root).toContain('min-h-10')
    expect(cls.tag).toContain('text-sm')
  })

  it('applies size sm', () => {
    const cls = tagsInputClasses({ size: 'sm' })
    expect(cls.root).toContain('min-h-8')
    expect(cls.tag).toContain('text-xs')
  })

  it('applies size lg', () => {
    const cls = tagsInputClasses({ size: 'lg' })
    expect(cls.root).toContain('min-h-12')
    expect(cls.root).toContain('rounded-lg')
  })

  it('static parts do not change', () => {
    const a = tagsInputClasses({ size: 'sm' })
    const b = tagsInputClasses({ size: 'lg' })
    expect(a.input).toBe(b.input)
    expect(a.tagRemove).toBe(b.tagRemove)
    expect(a.clearTrigger).toBe(b.clearTrigger)
  })
})
