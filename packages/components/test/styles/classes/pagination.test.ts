import { describe, it, expect } from 'vitest'
import { paginationClasses } from '../../../src/styles/classes/pagination'

describe('paginationClasses', () => {
  it('returns all part keys', () => {
    const cls = paginationClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('prevTrigger')
    expect(cls).toHaveProperty('nextTrigger')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('ellipsis')
  })

  it('uses medium defaults', () => {
    const cls = paginationClasses()
    expect(cls.item).toContain('w-9')
    expect(cls.item).toContain('h-9')
  })

  it('applies size sm', () => {
    const cls = paginationClasses({ size: 'sm' })
    expect(cls.item).toContain('w-7')
    expect(cls.prevTrigger).toContain('w-7')
  })

  it('applies size lg', () => {
    const cls = paginationClasses({ size: 'lg' })
    expect(cls.item).toContain('w-11')
    expect(cls.nextTrigger).toContain('w-11')
  })

  it('root and ellipsis are static', () => {
    const a = paginationClasses({ size: 'sm' })
    const b = paginationClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.ellipsis).toBe(b.ellipsis)
  })
})
