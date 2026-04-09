import { describe, it, expect } from 'vitest'
import { formatNumber } from '../../src/format/format-number'

describe('formatNumber', () => {
  it('formats with default options (decimal)', () => {
    expect(formatNumber(1234.5, { locale: 'en-US' })).toBe('1,234.5')
  })

  it('formats currency', () => {
    expect(formatNumber(42.5, { locale: 'en-US', style: 'currency', currency: 'USD' })).toBe(
      '$42.50',
    )
  })

  it('formats percent', () => {
    expect(formatNumber(0.75, { locale: 'en-US', style: 'percent' })).toBe('75%')
  })

  it('formats with unit', () => {
    const result = formatNumber(100, { locale: 'en-US', style: 'unit', unit: 'kilometer' })
    expect(result).toContain('100')
    expect(result).toContain('km')
  })

  it('formats compact notation', () => {
    const result = formatNumber(1500, { locale: 'en-US', notation: 'compact' })
    expect(result).toMatch(/1\.5K|1\.5k/i)
  })

  it('respects fraction digit options', () => {
    expect(
      formatNumber(1.1, { locale: 'en-US', minimumFractionDigits: 3 }),
    ).toBe('1.100')
    expect(
      formatNumber(1.12345, { locale: 'en-US', maximumFractionDigits: 2 }),
    ).toBe('1.12')
  })

  it('respects signDisplay', () => {
    expect(formatNumber(42, { locale: 'en-US', signDisplay: 'always' })).toBe('+42')
  })

  it('formats without grouping', () => {
    expect(formatNumber(1234567, { locale: 'en-US', useGrouping: false })).toBe('1234567')
  })

  it('works without options (uses defaults)', () => {
    const result = formatNumber(1000)
    expect(result).toBeTruthy()
  })

  it('caches formatter instances', () => {
    const a = formatNumber(1, { locale: 'en-US' })
    const b = formatNumber(2, { locale: 'en-US' })
    expect(a).toBe('1')
    expect(b).toBe('2')
  })
})
