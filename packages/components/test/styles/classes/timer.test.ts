import { describe, it, expect } from 'vitest'
import { timerClasses } from '../../../src/styles/classes/timer'

describe('timerClasses', () => {
  it('returns all part keys', () => {
    const cls = timerClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('display')
    expect(cls).toHaveProperty('startTrigger')
    expect(cls).toHaveProperty('pauseTrigger')
    expect(cls).toHaveProperty('resetTrigger')
  })

  it('uses medium defaults', () => {
    const cls = timerClasses()
    expect(cls.display).toContain('text-3xl')
  })

  it('applies size sm', () => {
    const cls = timerClasses({ size: 'sm' })
    expect(cls.display).toContain('text-xl')
  })

  it('applies size lg', () => {
    const cls = timerClasses({ size: 'lg' })
    expect(cls.display).toContain('text-5xl')
  })

  it('triggers are static', () => {
    const a = timerClasses({ size: 'sm' })
    const b = timerClasses({ size: 'lg' })
    expect(a.startTrigger).toBe(b.startTrigger)
    expect(a.pauseTrigger).toBe(b.pauseTrigger)
  })
})
