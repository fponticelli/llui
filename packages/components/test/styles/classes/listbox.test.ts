import { describe, it, expect } from 'vitest'
import { listboxClasses } from '../../../src/styles/classes/listbox'

describe('listboxClasses', () => {
  it('returns all part keys', () => {
    const cls = listboxClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
  })

  it('uses medium defaults', () => {
    const cls = listboxClasses()
    expect(cls.root).toContain('rounded-md')
    expect(cls.item).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = listboxClasses({ size: 'sm' })
    expect(cls.root).toContain('text-sm')
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = listboxClasses({ size: 'lg' })
    expect(cls.root).toContain('rounded-lg')
    expect(cls.item).toContain('text-lg')
  })
})
