import { describe, it, expect } from 'vitest'
import { editableClasses } from '../../../src/styles/classes/editable'

describe('editableClasses', () => {
  it('returns all part keys', () => {
    const cls = editableClasses()
    expect(cls).toHaveProperty('root')
    expect(cls).toHaveProperty('preview')
    expect(cls).toHaveProperty('input')
    expect(cls).toHaveProperty('submitTrigger')
    expect(cls).toHaveProperty('cancelTrigger')
    expect(cls).toHaveProperty('editTrigger')
  })

  it('uses medium defaults', () => {
    const cls = editableClasses()
    expect(cls.input).toContain('px-3')
  })

  it('applies size sm', () => {
    const cls = editableClasses({ size: 'sm' })
    expect(cls.input).toContain('text-sm')
  })

  it('applies size lg', () => {
    const cls = editableClasses({ size: 'lg' })
    expect(cls.input).toContain('text-lg')
  })

  it('static parts do not change', () => {
    const a = editableClasses({ size: 'sm' })
    const b = editableClasses({ size: 'lg' })
    expect(a.root).toBe(b.root)
    expect(a.preview).toBe(b.preview)
    expect(a.submitTrigger).toBe(b.submitTrigger)
  })
})
