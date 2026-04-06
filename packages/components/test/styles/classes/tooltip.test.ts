import { describe, it, expect } from 'vitest'
import { tooltipClasses } from '../../../src/styles/classes/tooltip'

describe('tooltipClasses', () => {
  it('returns all part keys', () => {
    const cls = tooltipClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('arrow')
  })

  it('uses medium defaults', () => {
    const cls = tooltipClasses()
    expect(cls.content).toContain('text-sm')
    expect(cls.content).toContain('max-w-64')
  })

  it('applies size sm', () => {
    const cls = tooltipClasses({ size: 'sm' })
    expect(cls.content).toContain('text-xs')
  })

  it('applies size lg', () => {
    const cls = tooltipClasses({ size: 'lg' })
    expect(cls.content).toContain('max-w-80')
  })
})
