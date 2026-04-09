import { describe, it, expect } from 'vitest'
import { formatDate, formatTime, formatDateTime } from '../../src/format/format-date'

const d = new Date('2026-04-08T14:30:00Z')

describe('formatDate', () => {
  it('formats with default dateStyle (medium)', () => {
    const result = formatDate(d, { locale: 'en-US', timeZone: 'UTC' })
    expect(result).toContain('Apr')
    expect(result).toContain('2026')
  })

  it('formats with dateStyle full', () => {
    const result = formatDate(d, { locale: 'en-US', dateStyle: 'full', timeZone: 'UTC' })
    expect(result).toContain('April')
    expect(result).toContain('2026')
  })

  it('formats with dateStyle short', () => {
    const result = formatDate(d, { locale: 'en-US', dateStyle: 'short', timeZone: 'UTC' })
    expect(result).toMatch(/4\/8\/26/)
  })

  it('accepts ISO string', () => {
    const result = formatDate('2026-04-08T14:30:00Z', { locale: 'en-US', timeZone: 'UTC' })
    expect(result).toContain('Apr')
  })

  it('accepts unix timestamp', () => {
    const result = formatDate(d.getTime(), { locale: 'en-US', timeZone: 'UTC' })
    expect(result).toContain('Apr')
  })

  it('formats with fine-grained options', () => {
    const result = formatDate(d, {
      locale: 'en-US',
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    expect(result).toContain('Wednesday')
    expect(result).toContain('April')
    expect(result).toContain('2026')
  })
})

describe('formatTime', () => {
  it('formats with default timeStyle (medium)', () => {
    const result = formatTime(d, { locale: 'en-US', timeZone: 'UTC' })
    expect(result).toContain('2:30')
  })

  it('formats with 24-hour clock', () => {
    const result = formatTime(d, { locale: 'en-US', timeZone: 'UTC', hour12: false })
    expect(result).toContain('14:30')
  })

  it('formats with fine-grained options', () => {
    const result = formatTime(d, {
      locale: 'en-US',
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(result).toContain('2:30')
  })
})

describe('formatDateTime', () => {
  it('formats with defaults (medium date + short time)', () => {
    const result = formatDateTime(d, { locale: 'en-US', timeZone: 'UTC' })
    expect(result).toContain('Apr')
    expect(result).toContain('2026')
    expect(result).toContain('2:30')
  })

  it('formats with full date and long time', () => {
    const result = formatDateTime(d, {
      locale: 'en-US',
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'long',
    })
    expect(result).toContain('April')
    expect(result).toContain('2026')
  })
})
