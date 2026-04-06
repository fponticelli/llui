import { describe, it, expect } from 'vitest'
import { scrollAreaClasses } from '../../../src/styles/classes/scroll-area'

describe('scrollAreaClasses', () => {
  it('returns all part keys', () => {
    const cls = scrollAreaClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('viewport')
    expect(cls).toHaveProperty('content')
    expect(cls).toHaveProperty('scrollbar')
    expect(cls).toHaveProperty('thumb')
    expect(cls).toHaveProperty('corner')
  })

  it('scrollbar supports orientation data attributes', () => {
    const cls = scrollAreaClasses()
    expect(cls.scrollbar).toContain('data-[orientation=vertical]:w-2.5')
    expect(cls.scrollbar).toContain('data-[orientation=horizontal]:h-2.5')
  })

  it('thumb has rounded styling', () => {
    const cls = scrollAreaClasses()
    expect(cls.thumb).toContain('rounded-full')
  })
})
