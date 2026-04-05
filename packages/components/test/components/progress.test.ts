import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, percent, valueState } from '../../src/components/progress'
import type { ProgressState } from '../../src/components/progress'

type Ctx = { p: ProgressState }
const wrap = (p: ProgressState): Ctx => ({ p })

describe('progress reducer', () => {
  it('initializes with value=0', () => {
    expect(init()).toMatchObject({ value: 0, min: 0, max: 100 })
  })

  it('setValue updates value', () => {
    const [s] = update(init(), { type: 'setValue', value: 50 })
    expect(s.value).toBe(50)
  })

  it('setValue null → indeterminate', () => {
    const [s] = update(init(), { type: 'setValue', value: null })
    expect(s.value).toBeNull()
  })
})

describe('progress helpers', () => {
  it('percent computes correctly', () => {
    expect(percent(init({ value: 50 }))).toBe(50)
    expect(percent(init({ value: 25, max: 200 }))).toBe(12.5)
    expect(percent(init({ value: null }))).toBeNull()
  })

  it('valueState reflects state', () => {
    expect(valueState(init({ value: null }))).toBe('indeterminate')
    expect(valueState(init({ value: 50 }))).toBe('loading')
    expect(valueState(init({ value: 100 }))).toBe('complete')
  })
})

describe('progress.connect', () => {
  const parts = connect<Ctx>((s) => s.p, vi.fn(), { label: 'Upload' })

  it('root has role=progressbar with aria-label', () => {
    expect(parts.root.role).toBe('progressbar')
    expect(parts.root['aria-label']).toBe('Upload')
  })

  it('aria-valuenow from state', () => {
    expect(parts.root['aria-valuenow'](wrap(init({ value: 42 })))).toBe(42)
    expect(parts.root['aria-valuenow'](wrap(init({ value: null })))).toBeUndefined()
  })

  it('data-state reflects state', () => {
    expect(parts.root['data-state'](wrap(init({ value: null })))).toBe('indeterminate')
    expect(parts.root['data-state'](wrap(init({ value: 50 })))).toBe('loading')
    expect(parts.root['data-state'](wrap(init({ value: 100 })))).toBe('complete')
  })

  it('range style reflects percent', () => {
    expect(parts.range.style(wrap(init({ value: 30 })))).toContain('width:30%')
  })

  it('vertical range uses height', () => {
    const s = init({ value: 40, orientation: 'vertical' })
    expect(parts.range.style(wrap(s))).toContain('height:40%')
  })

  it('valueText uses default format', () => {
    expect(parts.valueText(wrap(init({ value: 75 })))).toBe('75%')
    expect(parts.valueText(wrap(init({ value: null })))).toBe('Loading…')
  })

  it('custom formatter', () => {
    const p = connect<Ctx>(
      (s) => s.p,
      vi.fn(),
      { format: (v, max) => (v === null ? '?' : `${v}/${max}`) },
    )
    expect(p.valueText(wrap(init({ value: 30, max: 100 })))).toBe('30/100')
  })
})
