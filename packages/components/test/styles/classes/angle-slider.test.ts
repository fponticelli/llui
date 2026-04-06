import { describe, it, expect } from 'vitest'
import { angleSliderClasses } from '../../../src/styles/classes/angle-slider'

describe('angleSliderClasses', () => {
  it('returns all part keys', () => {
    const cls = angleSliderClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('control')
    expect(cls).toHaveProperty('thumb')
    expect(cls).toHaveProperty('valueText')
    expect(cls).toHaveProperty('hiddenInput')
  })

  it('uses medium defaults', () => {
    const cls = angleSliderClasses()
    expect(cls.root).toContain('w-24')
    expect(cls.thumb).toContain('w-4')
  })

  it('applies size sm', () => {
    const cls = angleSliderClasses({ size: 'sm' })
    expect(cls.root).toContain('w-16')
    expect(cls.thumb).toContain('w-3')
  })

  it('applies size lg', () => {
    const cls = angleSliderClasses({ size: 'lg' })
    expect(cls.root).toContain('w-32')
    expect(cls.thumb).toContain('w-5')
  })
})
