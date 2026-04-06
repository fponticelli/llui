import { describe, it, expect } from 'vitest'
import { splitterClasses } from '../../../src/styles/classes/splitter'

describe('splitterClasses', () => {
  it('returns all part keys', () => {
    const cls = splitterClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('primaryPanel')
    expect(cls).toHaveProperty('secondaryPanel')
    expect(cls).toHaveProperty('resizeTrigger')
  })

  it('uses horizontal defaults', () => {
    const cls = splitterClasses()
    expect(cls.root).toContain('flex-row')
    expect(cls.resizeTrigger).toContain('w-1')
    expect(cls.resizeTrigger).toContain('cursor-col-resize')
  })

  it('applies vertical orientation', () => {
    const cls = splitterClasses({ orientation: 'vertical' })
    expect(cls.root).toContain('flex-col')
    expect(cls.resizeTrigger).toContain('h-1')
    expect(cls.resizeTrigger).toContain('cursor-row-resize')
  })

  it('panels are static', () => {
    const a = splitterClasses({ orientation: 'horizontal' })
    const b = splitterClasses({ orientation: 'vertical' })
    expect(a.primaryPanel).toBe(b.primaryPanel)
    expect(a.secondaryPanel).toBe(b.secondaryPanel)
  })
})
