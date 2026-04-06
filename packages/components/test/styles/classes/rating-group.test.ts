import { describe, it, expect } from 'vitest'
import { ratingGroupClasses } from '../../../src/styles/classes/rating-group'

describe('ratingGroupClasses', () => {
  it('returns all part keys', () => {
    const cls = ratingGroupClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
  })

  it('uses medium defaults', () => {
    const cls = ratingGroupClasses()
    expect(cls.root).toContain('gap-1')
    expect(cls.item).toContain('text-xl')
  })

  it('applies size sm', () => {
    const cls = ratingGroupClasses({ size: 'sm' })
    expect(cls.root).toContain('gap-0.5')
    expect(cls.item).toContain('text-lg')
  })

  it('applies size lg', () => {
    const cls = ratingGroupClasses({ size: 'lg' })
    expect(cls.root).toContain('gap-1.5')
    expect(cls.item).toContain('text-2xl')
  })
})
