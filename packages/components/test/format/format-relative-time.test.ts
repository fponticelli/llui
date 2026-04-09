import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../../src/format/format-relative-time'

describe('formatRelativeTime', () => {
  it('formats past time', () => {
    expect(formatRelativeTime(-2, 'day', { locale: 'en-US' })).toBe('2 days ago')
  })

  it('formats future time', () => {
    expect(formatRelativeTime(3, 'hour', { locale: 'en-US' })).toBe('in 3 hours')
  })

  it('uses auto numeric for special values', () => {
    expect(formatRelativeTime(-1, 'day', { locale: 'en-US', numeric: 'auto' })).toBe('yesterday')
  })

  it('uses always numeric', () => {
    expect(formatRelativeTime(-1, 'day', { locale: 'en-US', numeric: 'always' })).toBe(
      '1 day ago',
    )
  })

  it('formats with narrow style', () => {
    const result = formatRelativeTime(-2, 'day', { locale: 'en-US', style: 'narrow' })
    expect(result).toContain('2')
  })

  it('handles zero', () => {
    const result = formatRelativeTime(0, 'second', { locale: 'en-US', numeric: 'auto' })
    expect(result).toBe('now')
  })

  it('works with all unit types', () => {
    for (const unit of [
      'year',
      'quarter',
      'month',
      'week',
      'day',
      'hour',
      'minute',
      'second',
    ] as const) {
      expect(formatRelativeTime(1, unit, { locale: 'en-US' })).toBeTruthy()
    }
  })
})
