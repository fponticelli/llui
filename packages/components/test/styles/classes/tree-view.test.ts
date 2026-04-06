import { describe, it, expect } from 'vitest'
import { treeViewClasses } from '../../../src/styles/classes/tree-view'

describe('treeViewClasses', () => {
  it('returns all part keys', () => {
    const cls = treeViewClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('branchTrigger')
    expect(cls).toHaveProperty('checkbox')
  })

  it('uses medium defaults', () => {
    const cls = treeViewClasses()
    expect(cls.item).toContain('py-1')
    expect(cls.item).toContain('gap-2')
  })

  it('applies size sm', () => {
    const cls = treeViewClasses({ size: 'sm' })
    expect(cls.item).toContain('text-sm')
    expect(cls.item).toContain('gap-1.5')
  })

  it('applies size lg', () => {
    const cls = treeViewClasses({ size: 'lg' })
    expect(cls.item).toContain('text-lg')
  })

  it('static parts do not change', () => {
    const a = treeViewClasses({ size: 'sm' })
    const b = treeViewClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.branchTrigger).toBe(b.branchTrigger)
    expect(a.checkbox).toBe(b.checkbox)
  })
})
