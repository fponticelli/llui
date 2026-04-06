import { describe, it, expect } from 'vitest'
import { carouselClasses } from '../../../src/styles/classes/carousel'

describe('carouselClasses', () => {
  it('returns all part keys', () => {
    const cls = carouselClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('viewport')
    expect(cls).toHaveProperty('slide')
    expect(cls).toHaveProperty('indicatorGroup')
    expect(cls).toHaveProperty('indicator')
    expect(cls).toHaveProperty('nextTrigger')
    expect(cls).toHaveProperty('prevTrigger')
  })

  it('uses medium defaults', () => {
    const cls = carouselClasses()
    expect(cls.nextTrigger).toContain('w-9')
    expect(cls.prevTrigger).toContain('w-9')
  })

  it('applies size sm', () => {
    const cls = carouselClasses({ size: 'sm' })
    expect(cls.nextTrigger).toContain('w-7')
  })

  it('applies size lg', () => {
    const cls = carouselClasses({ size: 'lg' })
    expect(cls.nextTrigger).toContain('w-11')
  })

  it('static parts do not change', () => {
    const a = carouselClasses({ size: 'sm' })
    const b = carouselClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.viewport).toBe(b.viewport)
    expect(a.indicator).toBe(b.indicator)
  })
})
