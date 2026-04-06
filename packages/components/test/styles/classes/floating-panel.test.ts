import { describe, it, expect } from 'vitest'
import { floatingPanelClasses } from '../../../src/styles/classes/floating-panel'

describe('floatingPanelClasses', () => {
  it('returns all part keys', () => {
    const cls = floatingPanelClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('dragHandle')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('minimizeTrigger')
    expect(cls).toHaveProperty('maximizeTrigger')
    expect(cls).toHaveProperty('closeTrigger')
    expect(cls).toHaveProperty('resizeHandle')
  })

  it('uses medium defaults', () => {
    const cls = floatingPanelClasses()
    expect(cls.root).toContain('min-w-80')
    expect(cls.root).toContain('min-h-60')
  })

  it('applies size sm', () => {
    const cls = floatingPanelClasses({ size: 'sm' })
    expect(cls.root).toContain('min-w-64')
  })

  it('applies size lg', () => {
    const cls = floatingPanelClasses({ size: 'lg' })
    expect(cls.root).toContain('min-w-96')
  })

  it('static parts do not change', () => {
    const a = floatingPanelClasses({ size: 'sm' })
    const b = floatingPanelClasses({ size: 'lg' })
    expect(a.dragHandle).toBe(b.dragHandle)
    expect(a.content).toBe(b.content)
    expect(a.closeTrigger).toBe(b.closeTrigger)
  })
})
