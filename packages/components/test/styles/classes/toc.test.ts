import { describe, it, expect } from 'vitest'
import { tocClasses } from '../../../src/styles/classes/toc'

describe('tocClasses', () => {
  it('returns all part keys', () => {
    const cls = tocClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('list')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('link')
    expect(cls).toHaveProperty('expandTrigger')
  })

  it('uses medium defaults', () => {
    const cls = tocClasses()
    expect(cls.link).toContain('text-sm')
    expect(cls.link).toContain('py-1')
  })

  it('applies size sm', () => {
    const cls = tocClasses({ size: 'sm' })
    expect(cls.link).toContain('text-xs')
  })

  it('applies size lg', () => {
    const cls = tocClasses({ size: 'lg' })
    expect(cls.link).toContain('py-1.5')
  })

  it('static parts do not change', () => {
    const a = tocClasses({ size: 'sm' })
    const b = tocClasses({ size: 'lg' })
    expect(a.list).toBe(b.list)
    expect(a.expandTrigger).toBe(b.expandTrigger)
  })
})
