import { describe, it, expect } from 'vitest'
import { formatPlural, resolvePluralCategory } from '../../src/format/format-plural'

describe('formatPlural', () => {
  const messages = {
    one: '{count} item',
    other: '{count} items',
  }

  it('selects singular', () => {
    expect(formatPlural(1, messages, { locale: 'en-US' })).toBe('1 item')
  })

  it('selects plural', () => {
    expect(formatPlural(5, messages, { locale: 'en-US' })).toBe('5 items')
  })

  it('selects zero when provided', () => {
    expect(formatPlural(0, { ...messages, zero: 'no items' }, { locale: 'en-US' })).toBe('no items')
  })

  it('falls back to other for zero without zero key', () => {
    expect(formatPlural(0, messages, { locale: 'en-US' })).toBe('0 items')
  })

  it('formats count with locale-aware number', () => {
    expect(formatPlural(1000, messages, { locale: 'en-US' })).toBe('1,000 items')
  })

  it('supports ordinal type', () => {
    const ordinals = {
      one: '{count}st',
      two: '{count}nd',
      few: '{count}rd',
      other: '{count}th',
    }
    expect(formatPlural(1, ordinals, { locale: 'en-US', type: 'ordinal' })).toBe('1st')
    expect(formatPlural(2, ordinals, { locale: 'en-US', type: 'ordinal' })).toBe('2nd')
    expect(formatPlural(3, ordinals, { locale: 'en-US', type: 'ordinal' })).toBe('3rd')
    expect(formatPlural(4, ordinals, { locale: 'en-US', type: 'ordinal' })).toBe('4th')
  })
})

describe('resolvePluralCategory', () => {
  it('returns one for 1 in English', () => {
    expect(resolvePluralCategory(1, { locale: 'en-US' })).toBe('one')
  })

  it('returns other for 0 in English', () => {
    expect(resolvePluralCategory(0, { locale: 'en-US' })).toBe('other')
  })

  it('returns other for 5 in English', () => {
    expect(resolvePluralCategory(5, { locale: 'en-US' })).toBe('other')
  })
})
