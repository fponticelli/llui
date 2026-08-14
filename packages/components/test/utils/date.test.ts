import { describe, it, expect } from 'vitest'
import { isDateOnly, parseDateValue } from '../../src/utils/date'

describe('isDateOnly', () => {
  it('recognises a bare calendar date', () => {
    expect(isDateOnly('2026-01-15')).toBe(true)
  })

  it('rejects anything carrying an instant', () => {
    expect(isDateOnly('2026-01-15T00:00:00Z')).toBe(false)
    expect(isDateOnly('2026-01-15T00:00')).toBe(false)
    expect(isDateOnly('2026-01')).toBe(false)
    expect(isDateOnly('15/01/2026')).toBe(false)
    expect(isDateOnly(new Date())).toBe(false)
    expect(isDateOnly(0)).toBe(false)
  })
})

describe('parseDateValue', () => {
  it('anchors a date-only string at UTC midnight and flags it', () => {
    const parsed = parseDateValue('2026-01-15')
    expect(parsed.dateOnly).toBe(true)
    expect(parsed.date.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })

  it('passes a Date through untouched', () => {
    const d = new Date('2026-01-15T12:34:56Z')
    const parsed = parseDateValue(d)
    expect(parsed.dateOnly).toBe(false)
    expect(parsed.date).toBe(d)
  })

  it('parses a timestamp and a full ISO string as instants', () => {
    expect(parseDateValue(0).date.getTime()).toBe(0)
    expect(parseDateValue(0).dateOnly).toBe(false)
    const iso = parseDateValue('2026-01-15T02:00:00Z')
    expect(iso.dateOnly).toBe(false)
    expect(iso.date.toISOString()).toBe('2026-01-15T02:00:00.000Z')
  })
})
