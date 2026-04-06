import { describe, it, expect } from 'vitest'
import { avatarClasses } from '../../../src/styles/classes/avatar'

describe('avatarClasses', () => {
  it('returns all part keys', () => {
    const cls = avatarClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('image')
    expect(cls).toHaveProperty('fallback')
  })

  it('uses medium defaults', () => {
    const cls = avatarClasses()
    expect(cls.root).toContain('w-10')
    expect(cls.root).toContain('h-10')
  })

  it('applies size sm', () => {
    const cls = avatarClasses({ size: 'sm' })
    expect(cls.root).toContain('w-8')
    expect(cls.root).toContain('h-8')
  })

  it('applies size xl', () => {
    const cls = avatarClasses({ size: 'xl' })
    expect(cls.root).toContain('w-20')
    expect(cls.root).toContain('h-20')
  })

  it('image and fallback are static', () => {
    const a = avatarClasses({ size: 'sm' })
    const b = avatarClasses({ size: 'xl' })
    expect(a.image).toBe(b.image)
    expect(a.fallback).toBe(b.fallback)
  })
})
