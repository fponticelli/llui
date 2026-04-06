import { describe, it, expect } from 'vitest'
import { dialogClasses } from '../../../src/styles/classes/dialog'

describe('dialogClasses', () => {
  it('returns all part keys', () => {
    const cls = dialogClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('backdrop')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('title')
    expect(cls).toHaveProperty('description')
    expect(cls).toHaveProperty('closeTrigger')
  })

  it('uses medium size by default', () => {
    const cls = dialogClasses()
    expect(cls.content).toContain('max-w-lg')
  })

  it('applies size sm', () => {
    const cls = dialogClasses({ size: 'sm' })
    expect(cls.content).toContain('max-w-sm')
  })

  it('applies size lg', () => {
    const cls = dialogClasses({ size: 'lg' })
    expect(cls.content).toContain('max-w-2xl')
  })

  it('applies size full', () => {
    const cls = dialogClasses({ size: 'full' })
    expect(cls.content).toContain('max-w-[calc(100vw-2rem)]')
  })

  it('static parts do not change with size', () => {
    const a = dialogClasses({ size: 'sm' })
    const b = dialogClasses({ size: 'lg' })
    expect(a.backdrop).toBe(b.backdrop)
    expect(a.positioner).toBe(b.positioner)
    expect(a.title).toBe(b.title)
    expect(a.description).toBe(b.description)
    expect(a.closeTrigger).toBe(b.closeTrigger)
  })
})
