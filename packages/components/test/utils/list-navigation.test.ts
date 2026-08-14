import { describe, it, expect } from 'vitest'
import {
  applySelection,
  firstEnabled,
  firstEnabledIndex,
  isEnabledItem,
  lastEnabled,
  lastEnabledIndex,
  nextEnabled,
  nextEnabledIndex,
  pruneToEnabled,
  rovingTabStop,
} from '../../src/utils/list-navigation'

const items = ['a', 'b', 'c', 'd']

describe('value-based navigation', () => {
  it('firstEnabled / lastEnabled skip disabled items', () => {
    expect(firstEnabled(items, ['a', 'b'])).toBe('c')
    expect(lastEnabled(items, ['c', 'd'])).toBe('b')
    expect(firstEnabled(items, items)).toBeNull()
    expect(lastEnabled([], [])).toBeNull()
  })

  it('nextEnabled steps over disabled items', () => {
    expect(nextEnabled(items, ['b'], 'a', 1, true)).toBe('c')
    expect(nextEnabled(items, ['b'], 'c', -1, true)).toBe('a')
  })

  it('nextEnabled wraps only when loop is on', () => {
    expect(nextEnabled(items, [], 'd', 1, true)).toBe('a')
    expect(nextEnabled(items, [], 'd', 1, false)).toBeNull()
    expect(nextEnabled(items, [], 'a', -1, true)).toBe('d')
    expect(nextEnabled(items, [], 'a', -1, false)).toBeNull()
  })

  it('falls back to the first enabled item for an unknown `from` (#126)', () => {
    // The three copies disagreed here — roving answered 'a', toolbar and
    // radio-group answered "unchanged". One rule: a `from` that no longer names
    // an item is a stale reference, and navigation restarts at the first
    // enabled item rather than dead-ending.
    expect(nextEnabled(items, [], 'zzz', 1, true)).toBe('a')
    expect(nextEnabled(items, [], 'zzz', -1, true)).toBe('a')
    expect(nextEnabled(items, ['a'], 'zzz', 1, false)).toBe('b')
    expect(nextEnabled([], [], 'zzz', 1, true)).toBeNull()
  })
})

describe('isEnabledItem / pruneToEnabled', () => {
  it('an item must be present AND not disabled', () => {
    expect(isEnabledItem(items, ['b'], 'a')).toBe(true)
    expect(isEnabledItem(items, ['b'], 'b')).toBe(false)
    expect(isEnabledItem(items, [], 'zzz')).toBe(false)
  })

  it('pruneToEnabled drops a value the list no longer holds', () => {
    expect(pruneToEnabled(items, [], 'a')).toBe('a')
    expect(pruneToEnabled(items, ['a'], 'a')).toBeNull()
    expect(pruneToEnabled(['b'], [], 'a')).toBeNull()
    expect(pruneToEnabled(items, [], null)).toBeNull()
  })
})

describe('rovingTabStop', () => {
  it('prefers the given candidates in order', () => {
    expect(rovingTabStop(items, [], 'c')).toBe('c')
    expect(rovingTabStop(items, [], null, 'b')).toBe('b')
  })

  it('always names a tab stop when one enabled item exists (#126)', () => {
    // WAI-ARIA's roving tabindex requires EXACTLY ONE tab stop. A stale or
    // absent preference used to leave every item at -1, dropping the whole
    // widget out of the Tab order.
    expect(rovingTabStop(items, [], null)).toBe('a')
    expect(rovingTabStop(items, [], 'removed')).toBe('a')
    expect(rovingTabStop(items, ['a'], 'a')).toBe('b')
  })

  it('names none when every item is disabled', () => {
    expect(rovingTabStop(items, items, 'a')).toBeNull()
    expect(rovingTabStop([], [], null)).toBeNull()
  })
})

describe('index-based navigation', () => {
  it('firstEnabledIndex / lastEnabledIndex skip disabled items', () => {
    expect(firstEnabledIndex(items, ['a'])).toBe(1)
    expect(lastEnabledIndex(items, ['d'])).toBe(2)
    expect(firstEnabledIndex(items, items)).toBeNull()
  })

  it('nextEnabledIndex wraps and skips disabled items', () => {
    expect(nextEnabledIndex(items, [], 0, 1)).toBe(1)
    expect(nextEnabledIndex(items, ['b'], 0, 1)).toBe(2)
    expect(nextEnabledIndex(items, [], 3, 1)).toBe(0)
    expect(nextEnabledIndex(items, [], 0, -1)).toBe(3)
    expect(nextEnabledIndex([], [], null, 1)).toBeNull()
  })

  it('starts at the ends when `from` is null', () => {
    expect(nextEnabledIndex(items, [], null, 1)).toBe(0)
    expect(nextEnabledIndex(items, [], null, -1)).toBe(3)
  })
})

describe('applySelection', () => {
  it('single mode replaces the selection', () => {
    expect(applySelection(['a'], 'b', { mode: 'single', disabled: [] })).toEqual(['b'])
  })

  it('multiple mode toggles', () => {
    expect(applySelection(['a'], 'b', { mode: 'multiple', disabled: [] })).toEqual(['a', 'b'])
    expect(applySelection(['a', 'b'], 'b', { mode: 'multiple', disabled: [] })).toEqual(['a'])
  })

  it('a disabled item cannot change the selection — same reference back', () => {
    const current = ['a']
    expect(applySelection(current, 'b', { mode: 'multiple', disabled: ['b'] })).toBe(current)
  })
})
