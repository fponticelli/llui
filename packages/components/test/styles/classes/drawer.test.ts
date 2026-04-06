import { describe, it, expect } from 'vitest'
import { drawerClasses } from '../../../src/styles/classes/drawer'

describe('drawerClasses', () => {
  it('returns all part keys', () => {
    const cls = drawerClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('backdrop')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('title')
    expect(cls).toHaveProperty('description')
    expect(cls).toHaveProperty('closeTrigger')
  })

  it('uses medium/right defaults', () => {
    const cls = drawerClasses()
    expect(cls.positioner).toContain('justify-end')
    expect(cls.content).toContain('h-full')
    expect(cls.content).toContain('w-80')
  })

  it('applies left placement', () => {
    const cls = drawerClasses({ placement: 'left' })
    expect(cls.positioner).toContain('justify-start')
    expect(cls.content).toContain('h-full')
  })

  it('applies bottom placement', () => {
    const cls = drawerClasses({ placement: 'bottom' })
    expect(cls.positioner).toContain('justify-end')
    expect(cls.content).toContain('w-full')
  })

  it('applies size sm with placement', () => {
    const cls = drawerClasses({ size: 'sm', placement: 'right' })
    expect(cls.content).toContain('w-64')
  })

  it('applies size lg with placement', () => {
    const cls = drawerClasses({ size: 'lg', placement: 'right' })
    expect(cls.content).toContain('w-96')
  })

  it('static parts do not change', () => {
    const a = drawerClasses({ size: 'sm' })
    const b = drawerClasses({ size: 'lg' })
    expect(a.backdrop).toBe(b.backdrop)
    expect(a.title).toBe(b.title)
    expect(a.closeTrigger).toBe(b.closeTrigger)
  })
})
