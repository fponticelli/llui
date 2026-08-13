import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { formatDate, formatDateTime } from '../../src/format/format-date'

/**
 * A date-only string ('2026-01-15') is a CALENDAR date, not an instant.
 * `new Date('2026-01-15')` reads it as UTC midnight, so rendering it with the
 * ambient zone shows the PREVIOUS day everywhere west of UTC — the whole class
 * of bug passes unnoticed for anyone east of UTC (#125 defect 4).
 *
 * This file pins the behaviour under a negative-offset zone. It lives apart
 * from `format-date.test.ts` because the Intl formatter cache is per module
 * registry (one per test file) and would otherwise hand back a formatter built
 * under a different ambient zone.
 */

// `TZ` is read back by V8 on assignment, so stubbing it moves the ambient zone
// for every Date/Intl call in this file.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/New_York')
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('date-only values under a negative-offset timezone', () => {
  it('renders the written calendar date', () => {
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0) // guard: TZ really switched
    expect(formatDate('2026-01-15', { locale: 'en-US', dateStyle: 'long' })).toBe(
      'January 15, 2026',
    )
  })

  it('renders the written calendar date with fine-grained fields', () => {
    expect(
      formatDate('2026-01-15', { locale: 'en-US', year: 'numeric', month: 'long', day: 'numeric' }),
    ).toBe('January 15, 2026')
  })

  it('ignores an explicit timeZone for a date-only value (it carries no instant)', () => {
    expect(
      formatDate('2026-01-15', { locale: 'en-US', dateStyle: 'long', timeZone: 'Asia/Tokyo' }),
    ).toBe('January 15, 2026')
  })

  it('still honours the ambient zone for a real instant', () => {
    // 2026-01-15T02:00Z is still 14 January in New York — a timestamped value
    // DOES have an instant, so it must not get the date-only treatment.
    expect(formatDate('2026-01-15T02:00:00Z', { locale: 'en-US', dateStyle: 'long' })).toBe(
      'January 14, 2026',
    )
  })

  it('formatDateTime renders a date-only value at the start of that calendar day', () => {
    expect(formatDateTime('2026-01-15', { locale: 'en-US', dateStyle: 'long' })).toContain(
      'January 15, 2026',
    )
  })
})
