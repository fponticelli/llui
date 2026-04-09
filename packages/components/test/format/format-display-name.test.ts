import { describe, it, expect } from 'vitest'
import { formatDisplayName } from '../../src/format/format-display-name'

describe('formatDisplayName', () => {
  it('formats language name', () => {
    expect(formatDisplayName('en-US', 'language', { locale: 'en-US' })).toBe(
      'American English',
    )
  })

  it('formats region name', () => {
    expect(formatDisplayName('US', 'region', { locale: 'en-US' })).toBe('United States')
  })

  it('formats currency name', () => {
    expect(formatDisplayName('EUR', 'currency', { locale: 'en-US' })).toBe('Euro')
  })

  it('formats script name', () => {
    expect(formatDisplayName('Latn', 'script', { locale: 'en-US' })).toBe('Latin')
  })

  it('falls back to code when not found', () => {
    expect(formatDisplayName('XX', 'region', { locale: 'en-US', fallback: 'code' })).toBe('XX')
  })

  it('returns undefined with fallback none', () => {
    expect(
      formatDisplayName('ZZZZZ', 'region', { locale: 'en-US', fallback: 'none' }),
    ).toBeUndefined()
  })

  it('formats with standard language display', () => {
    const result = formatDisplayName('en-US', 'language', {
      locale: 'en-US',
      languageDisplay: 'standard',
    })
    expect(result).toContain('English')
  })
})
