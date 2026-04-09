import { describe, it, expect } from 'vitest'
import { formatList } from '../../src/format/format-list'

describe('formatList', () => {
  it('formats conjunction (and)', () => {
    expect(formatList(['apples', 'bananas', 'oranges'], { locale: 'en-US' })).toBe(
      'apples, bananas, and oranges',
    )
  })

  it('formats disjunction (or)', () => {
    expect(formatList(['red', 'blue', 'green'], { locale: 'en-US', type: 'disjunction' })).toBe(
      'red, blue, or green',
    )
  })

  it('formats unit list', () => {
    const result = formatList(['3 feet', '7 inches'], { locale: 'en-US', type: 'unit' })
    expect(result).toContain('3 feet')
    expect(result).toContain('7 inches')
  })

  it('handles two items', () => {
    expect(formatList(['a', 'b'], { locale: 'en-US' })).toBe('a and b')
  })

  it('handles single item', () => {
    expect(formatList(['only'], { locale: 'en-US' })).toBe('only')
  })

  it('handles empty array', () => {
    expect(formatList([], { locale: 'en-US' })).toBe('')
  })

  it('formats with narrow style', () => {
    const result = formatList(['a', 'b', 'c'], { locale: 'en-US', style: 'narrow' })
    expect(result).toBeTruthy()
  })
})
