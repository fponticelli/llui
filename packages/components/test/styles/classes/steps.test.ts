import { describe, it, expect } from 'vitest'
import { stepsClasses } from '../../../src/styles/classes/steps'

describe('stepsClasses', () => {
  it('returns all part keys', () => {
    const cls = stepsClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('item')
    expect(cls).toHaveProperty('trigger')
    expect(cls).toHaveProperty('separator')
  })

  it('uses medium/horizontal defaults', () => {
    const cls = stepsClasses()
    expect(cls.root).toContain('flex-row')
    expect(cls.trigger).toContain('w-9')
    expect(cls.separator).toContain('h-0.5')
  })

  it('applies vertical orientation', () => {
    const cls = stepsClasses({ orientation: 'vertical' })
    expect(cls.root).toContain('flex-col')
    expect(cls.separator).toContain('w-0.5')
  })

  it('applies size sm', () => {
    const cls = stepsClasses({ size: 'sm' })
    expect(cls.trigger).toContain('w-7')
  })

  it('applies size lg', () => {
    const cls = stepsClasses({ size: 'lg' })
    expect(cls.trigger).toContain('w-11')
  })
})
