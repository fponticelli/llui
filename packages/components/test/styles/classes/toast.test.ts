import { describe, it, expect } from 'vitest'
import { toastClasses } from '../../../src/styles/classes/toast'

describe('toastClasses', () => {
  it('returns all part keys', () => {
    const cls = toastClasses()
    expect(cls).toHaveProperty('region')
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('title')
    expect(cls).toHaveProperty('description')
    expect(cls).toHaveProperty('closeTrigger')
  })

  it('uses medium/default defaults', () => {
    const cls = toastClasses()
    expect(cls.root).toContain('min-w-80')
    expect(cls.root).toContain('rounded-lg')
  })

  it('applies size sm', () => {
    const cls = toastClasses({ size: 'sm' })
    expect(cls.root).toContain('min-w-64')
    expect(cls.root).toContain('text-sm')
  })

  it('applies error variant', () => {
    const cls = toastClasses({ variant: 'error' })
    expect(cls.root).toContain('border-l-destructive')
  })

  it('applies success variant', () => {
    const cls = toastClasses({ variant: 'success' })
    expect(cls.root).toContain('border-l-primary')
  })

  it('static parts do not change', () => {
    const a = toastClasses({ size: 'sm' })
    const b = toastClasses({ size: 'lg' })
    expect(a.region).toBe(b.region)
    expect(a.title).toBe(b.title)
    expect(a.closeTrigger).toBe(b.closeTrigger)
  })
})
