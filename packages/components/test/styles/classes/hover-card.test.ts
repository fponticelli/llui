import { describe, it, expect } from 'vitest'
import { hoverCardClasses } from '../../../src/styles/classes/hover-card'

describe('hoverCardClasses', () => {
  it('returns all part keys', () => {
    const cls = hoverCardClasses()
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('positioner')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('arrow')
  })

  it('uses medium defaults', () => {
    const cls = hoverCardClasses()
    expect(cls.content).toContain('max-w-72')
  })

  it('applies size sm', () => {
    const cls = hoverCardClasses({ size: 'sm' })
    expect(cls.content).toContain('max-w-56')
  })

  it('applies size lg', () => {
    const cls = hoverCardClasses({ size: 'lg' })
    expect(cls.content).toContain('max-w-96')
  })
})
