import { describe, it, expect } from 'vitest'
import { toggleGroupClasses } from '../../../src/styles/classes/toggle-group'

describe('toggleGroupClasses', () => {
  it('returns all part keys', () => {
    const cls = toggleGroupClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
  })

  it('uses horizontal/medium defaults', () => {
    const cls = toggleGroupClasses()
    expect(cls.root).toContain('flex-row')
    expect(cls.item).toContain('px-3')
  })

  it('applies vertical orientation', () => {
    const cls = toggleGroupClasses({ orientation: 'vertical' })
    expect(cls.root).toContain('flex-col')
  })

  it('applies size sm', () => {
    const cls = toggleGroupClasses({ size: 'sm' })
    expect(cls.item).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = toggleGroupClasses({ size: 'lg' })
    expect(cls.item).toContain('text-lg')
  })
})
