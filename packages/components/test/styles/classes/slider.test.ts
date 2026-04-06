import { describe, it, expect } from 'vitest'
import { sliderClasses } from '../../../src/styles/classes/slider'

describe('sliderClasses', () => {
  it('returns all part keys', () => {
    const cls = sliderClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('control')
    expect(cls).toHaveProperty('track')
    expect(cls).toHaveProperty('range')
    expect(cls).toHaveProperty('thumb')
  })

  it('uses medium defaults', () => {
    const cls = sliderClasses()
    expect(cls.control).toContain('h-5')
    expect(cls.track).toContain('h-1.5')
    expect(cls.thumb).toContain('w-4.5')
  })

  it('applies size sm', () => {
    const cls = sliderClasses({ size: 'sm' })
    expect(cls.control).toContain('h-4')
    expect(cls.track).toContain('h-1')
    expect(cls.thumb).toContain('w-3.5')
  })

  it('applies size lg', () => {
    const cls = sliderClasses({ size: 'lg' })
    expect(cls.control).toContain('h-6')
    expect(cls.track).toContain('h-2')
  })

  it('root and range are static', () => {
    const a = sliderClasses({ size: 'sm' })
    const b = sliderClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.range).toBe(b.range)
  })
})
