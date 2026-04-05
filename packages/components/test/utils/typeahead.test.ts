import { describe, it, expect } from 'vitest'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  typeaheadMatchByItems,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../../src/utils/typeahead'

describe('typeaheadAccumulate', () => {
  it('starts a new query when the previous one expired', () => {
    const result = typeaheadAccumulate('abc', 'x', 1000, 500) // now > expiresAt → reset
    expect(result).toBe('x')
  })

  it('appends when within the timeout window', () => {
    const result = typeaheadAccumulate('abc', 'x', 400, 500) // now < expiresAt → append
    expect(result).toBe('abcx')
  })

  it('starts a new query from an empty buffer', () => {
    expect(typeaheadAccumulate('', 's', 0, 0)).toBe('s')
  })
})

describe('typeaheadMatch', () => {
  const items = ['apple', 'banana', 'cherry', 'date']
  const none = [false, false, false, false]

  it('finds a single-letter match', () => {
    expect(typeaheadMatch(items, none, 'b', null)).toBe(1)
    expect(typeaheadMatch(items, none, 'c', null)).toBe(2)
  })

  it('is case-insensitive', () => {
    expect(typeaheadMatch(items, none, 'B', null)).toBe(1)
    expect(typeaheadMatch(['Apple', 'Banana'], [false, false], 'a', null)).toBe(0)
  })

  it('advances past current index on single-char queries (cycling)', () => {
    // Two items start with 'a'
    const list = ['apple', 'apricot', 'banana']
    const mask = [false, false, false]
    // From index 0 ('apple'), next 'a' match should be 'apricot' (index 1)
    expect(typeaheadMatch(list, mask, 'a', 0)).toBe(1)
    // From index 1 ('apricot'), next 'a' match should wrap to 'apple' (index 0)
    expect(typeaheadMatch(list, mask, 'a', 1)).toBe(0)
  })

  it('does NOT advance past current on multi-char queries (stays if current matches)', () => {
    // Multi-char queries search from current cursor (inclusive) — so if the
    // current position already matches, it stays. This matches WAI-ARIA
    // behavior: typing "ap" while on 'apricot' keeps you on 'apricot'.
    const list = ['apple', 'apricot']
    expect(typeaheadMatch(list, [false, false], 'ap', 1)).toBe(1)
    expect(typeaheadMatch(list, [false, false], 'apr', 0)).toBe(1)
  })

  it('skips disabled items', () => {
    const list = ['apple', 'apricot', 'avocado']
    const mask = [true, false, true] // apple + avocado disabled
    expect(typeaheadMatch(list, mask, 'a', null)).toBe(1) // only apricot
  })

  it('returns null when no match', () => {
    expect(typeaheadMatch(items, none, 'z', null)).toBeNull()
    expect(typeaheadMatch([], [], 'a', null)).toBeNull()
    expect(typeaheadMatch(items, none, '', null)).toBeNull()
  })

  it('wraps around the end of the list', () => {
    // Cursor past the target → wrap
    expect(typeaheadMatch(items, none, 'a', 3)).toBe(0) // from 'date', 'a' wraps to 'apple'
  })
})

describe('typeaheadMatchByItems', () => {
  it('converts disabled value list to a mask', () => {
    const items = ['red', 'green', 'blue', 'yellow']
    expect(typeaheadMatchByItems(items, ['green'], 'g', null)).toBeNull()
    expect(typeaheadMatchByItems(items, ['red'], 'r', null)).toBeNull()
    expect(typeaheadMatchByItems(items, [], 'b', null)).toBe(2)
  })
})

describe('isTypeaheadKey', () => {
  const make = (key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): KeyboardEvent =>
    ({
      key,
      ctrlKey: mods.ctrl ?? false,
      metaKey: mods.meta ?? false,
      altKey: mods.alt ?? false,
    }) as KeyboardEvent

  it('accepts single printable characters', () => {
    expect(isTypeaheadKey(make('a'))).toBe(true)
    expect(isTypeaheadKey(make('Z'))).toBe(true)
    expect(isTypeaheadKey(make('7'))).toBe(true)
    expect(isTypeaheadKey(make('!'))).toBe(true)
  })

  it('rejects modifier-combined keys', () => {
    expect(isTypeaheadKey(make('a', { ctrl: true }))).toBe(false)
    expect(isTypeaheadKey(make('a', { meta: true }))).toBe(false)
    expect(isTypeaheadKey(make('a', { alt: true }))).toBe(false)
  })

  it('rejects multi-character keys (Arrow, Enter, etc.)', () => {
    expect(isTypeaheadKey(make('ArrowDown'))).toBe(false)
    expect(isTypeaheadKey(make('Enter'))).toBe(false)
    expect(isTypeaheadKey(make('Escape'))).toBe(false)
    expect(isTypeaheadKey(make('Tab'))).toBe(false)
  })

  it('rejects space (commonly used for activation, not search)', () => {
    expect(isTypeaheadKey(make(' '))).toBe(false)
  })
})

describe('TYPEAHEAD_TIMEOUT_MS', () => {
  it('exports a reasonable default', () => {
    expect(TYPEAHEAD_TIMEOUT_MS).toBeGreaterThan(0)
    expect(TYPEAHEAD_TIMEOUT_MS).toBeLessThan(2000)
  })
})
