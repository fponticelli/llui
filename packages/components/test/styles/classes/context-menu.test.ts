import { describe, it, expect } from 'vitest'
import { contextMenuClasses } from '../../../src/styles/classes/context-menu'

describe('contextMenuClasses', () => {
  it('returns all part keys', () => {
    const cls = contextMenuClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('item')
  })

  it('uses medium defaults', () => {
    const cls = contextMenuClasses()
    expect(cls.content).toContain('min-w-48')
    expect(cls.item).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = contextMenuClasses({ size: 'sm' })
    expect(cls.content).toContain('min-w-32')
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = contextMenuClasses({ size: 'lg' })
    expect(cls.content).toContain('rounded-lg')
    expect(cls.item).toContain('text-lg')
  })
})
