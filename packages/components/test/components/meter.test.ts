import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, percent, thresholdState } from '../../src/components/meter'
import { rootSignal, read } from '../_signal'

describe('meter reducer', () => {
  it('initializes with value=0 and default range', () => {
    expect(init()).toMatchObject({ value: 0, min: 0, max: 100 })
  })

  it('omits optional thresholds when not provided', () => {
    const s = init({ value: 10 })
    expect('low' in s).toBe(false)
    expect('high' in s).toBe(false)
    expect('optimum' in s).toBe(false)
  })

  it('carries optional thresholds through init', () => {
    expect(init({ low: 20, high: 80, optimum: 90 })).toMatchObject({
      low: 20,
      high: 80,
      optimum: 90,
    })
  })

  it('setValue updates value', () => {
    const [s] = update(init(), { type: 'setValue', value: 50 })
    expect(s.value).toBe(50)
  })

  it('setMax updates max', () => {
    const [s] = update(init(), { type: 'setMax', max: 200 })
    expect(s.max).toBe(200)
  })
})

describe('meter percent', () => {
  it('computes correctly', () => {
    expect(percent(init({ value: 50 }))).toBe(50)
    expect(percent(init({ value: 25, max: 200 }))).toBe(12.5)
  })

  it('respects min offset', () => {
    expect(percent(init({ value: 30, min: 20, max: 40 }))).toBe(50)
  })

  it('returns 0 for a non-positive range', () => {
    expect(percent(init({ value: 5, min: 10, max: 10 }))).toBe(0)
  })
})

describe('meter thresholdState', () => {
  it('returns optimal when optimum is missing (no preference)', () => {
    expect(thresholdState(init({ value: 5, low: 20, high: 80 }))).toBe('optimal')
    expect(thresholdState(init({ value: 50, low: 20, high: 80 }))).toBe('optimal')
    expect(thresholdState(init({ value: 95, low: 20, high: 80 }))).toBe('optimal')
  })

  describe('optimum in the high segment (higher is better)', () => {
    const base = { low: 20, high: 80, optimum: 90 }
    it('high segment → optimal', () => {
      expect(thresholdState(init({ value: 90, ...base }))).toBe('optimal')
    })
    it('middle segment (adjacent) → high', () => {
      expect(thresholdState(init({ value: 50, ...base }))).toBe('high')
    })
    it('low segment (far) → low', () => {
      expect(thresholdState(init({ value: 10, ...base }))).toBe('low')
    })
  })

  describe('optimum in the low segment (lower is better)', () => {
    const base = { low: 20, high: 80, optimum: 10 }
    it('low segment → optimal', () => {
      expect(thresholdState(init({ value: 5, ...base }))).toBe('optimal')
    })
    it('middle segment (adjacent) → high', () => {
      expect(thresholdState(init({ value: 50, ...base }))).toBe('high')
    })
    it('high segment (far) → low', () => {
      expect(thresholdState(init({ value: 95, ...base }))).toBe('low')
    })
  })

  describe('optimum in the middle segment (midpoint is best)', () => {
    const base = { low: 20, high: 80, optimum: 50 }
    it('middle → optimal', () => {
      expect(thresholdState(init({ value: 50, ...base }))).toBe('optimal')
    })
    it('low segment (adjacent) → high', () => {
      expect(thresholdState(init({ value: 10, ...base }))).toBe('high')
    })
    it('high segment (adjacent) → high', () => {
      expect(thresholdState(init({ value: 95, ...base }))).toBe('high')
    })
  })

  describe('boundary values', () => {
    const base = { low: 20, high: 80, optimum: 90 }
    it('value exactly at low is in the middle segment (not below low)', () => {
      // value === low is NOT < low → middle segment → adjacent to high-optimum → high
      expect(thresholdState(init({ value: 20, ...base }))).toBe('high')
    })
    it('value exactly at high is in the middle segment (not above high)', () => {
      // value === high is NOT > high → middle segment → high
      expect(thresholdState(init({ value: 80, ...base }))).toBe('high')
    })
  })

  it('treats a missing low/high as a single middle segment', () => {
    // No low/high → everything is the middle segment → matches a middle optimum
    expect(thresholdState(init({ value: 10, optimum: 50 }))).toBe('optimal')
  })
})

describe('meter.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { label: 'Disk usage' })

  it('root has role=meter with aria-label', () => {
    expect(parts.root.role).toBe('meter')
    expect(parts.root['aria-label']).toBe('Disk usage')
  })

  it('reports valuemin/valuemax/valuenow', () => {
    const s = init({ value: 42, min: 0, max: 100 })
    expect(read(parts.root['aria-valuemin'], s)).toBe(0)
    expect(read(parts.root['aria-valuemax'], s)).toBe(100)
    expect(read(parts.root['aria-valuenow'], s)).toBe(42)
  })

  it('aria-valuetext uses the default percent format', () => {
    expect(read(parts.root['aria-valuetext'], init({ value: 75 }))).toBe('75%')
  })

  it('aria-valuetext honors min offset (matches the rendered bar)', () => {
    const s = init({ value: 75, min: 50, max: 100 })
    // (75-50)/(100-50) = 50% — must match the range bar, not value/max (75%).
    expect(read(parts.root['aria-valuetext'], s)).toBe('50%')
    expect(read(parts.valueText, s)).toBe('50%')
  })

  it('aria-valuetext honors a custom formatter', () => {
    const p = connect(rootSignal(), vi.fn(), {
      format: (v, max) => `${v} of ${max} GB`,
    })
    expect(read(p.root['aria-valuetext'], init({ value: 30, max: 100 }))).toBe('30 of 100 GB')
    expect(read(p.valueText, init({ value: 30, max: 100 }))).toBe('30 of 100 GB')
  })

  it('data-state reflects the threshold band', () => {
    const base = { low: 20, high: 80, optimum: 90 }
    expect(read(parts.root['data-state'], init({ value: 90, ...base }))).toBe('optimal')
    expect(read(parts.root['data-state'], init({ value: 50, ...base }))).toBe('high')
    expect(read(parts.root['data-state'], init({ value: 10, ...base }))).toBe('low')
  })

  it('range style is percent-driven via inline-size', () => {
    expect(read(parts.range.style, init({ value: 30 }))).toContain('inline-size:30%')
  })

  it('range style clamps out-of-range values', () => {
    expect(read(parts.range.style, init({ value: 150 }))).toContain('inline-size:100%')
    expect(read(parts.range.style, init({ value: -20 }))).toContain('inline-size:0%')
  })

  it('track and range carry the same data-state', () => {
    const s = init({ value: 10, low: 20, high: 80, optimum: 90 })
    expect(read(parts.track['data-state'], s)).toBe('low')
    expect(read(parts.range['data-state'], s)).toBe('low')
  })
})
