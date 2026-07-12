import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, percent, valueState } from '../../src/components/progress'
import { rootSignal, read } from '../_signal'

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
  const parts = connect(rootSignal(), vi.fn(), { label: 'Upload' })

  it('root has role=progressbar with aria-label', () => {
    expect(parts.root.role).toBe('progressbar')
    expect(parts.root['aria-label']).toBe('Upload')
  })

  it('aria-valuenow from state', () => {
    expect(read(parts.root['aria-valuenow'], init({ value: 42 }))).toBe(42)
    expect(read(parts.root['aria-valuenow'], init({ value: null }))).toBeUndefined()
  })

  it('data-state reflects state', () => {
    expect(read(parts.root['data-state'], init({ value: null }))).toBe('indeterminate')
    expect(read(parts.root['data-state'], init({ value: 50 }))).toBe('loading')
    expect(read(parts.root['data-state'], init({ value: 100 }))).toBe('complete')
  })

  it('range style reflects percent', () => {
    expect(read(parts.range.style, init({ value: 30 }))).toContain('width:30%')
  })

  it('vertical range uses height', () => {
    const s = init({ value: 40, orientation: 'vertical' })
    expect(read(parts.range.style, s)).toContain('height:40%')
  })

  it('valueText uses default format', () => {
    expect(read(parts.valueText, init({ value: 75 }))).toBe('75%')
    expect(read(parts.valueText, init({ value: null }))).toBe('Loading…')
  })

  it('valueText honors min offset (matches the rendered bar)', () => {
    const s = init({ value: 75, min: 50, max: 100 })
    // (75-50)/(100-50) = 50% — must match the range bar, not value/max (75%).
    expect(read(parts.valueText, s)).toBe('50%')
  })

  it('custom formatter', () => {
    const p = connect(rootSignal(), vi.fn(), {
      format: (v, max) => (v === null ? '?' : `${v}/${max}`),
    })
    expect(read(p.valueText, init({ value: 30, max: 100 }))).toBe('30/100')
  })
})
