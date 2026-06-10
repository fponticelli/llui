import { describe, it, expect, beforeEach } from 'vitest'
import {
  firstEnabled,
  lastEnabled,
  nextEnabled,
  resolveRovingMove,
  focusRovingTab,
  type RovingItem,
} from '../../src/utils/roving'

describe('firstEnabled / lastEnabled', () => {
  it('returns the first/last value when none disabled', () => {
    expect(firstEnabled(['a', 'b', 'c'], [])).toBe('a')
    expect(lastEnabled(['a', 'b', 'c'], [])).toBe('c')
  })

  it('skips disabled entries from each end', () => {
    expect(firstEnabled(['a', 'b', 'c'], ['a'])).toBe('b')
    expect(lastEnabled(['a', 'b', 'c'], ['c'])).toBe('b')
  })

  it('returns null when the list is empty or all disabled', () => {
    expect(firstEnabled([], [])).toBeNull()
    expect(lastEnabled(['a', 'b'], ['a', 'b'])).toBeNull()
  })
})

describe('nextEnabled', () => {
  const items = ['a', 'b', 'c', 'd']

  it('moves forward and backward', () => {
    expect(nextEnabled(items, [], 'b', 1, true)).toBe('c')
    expect(nextEnabled(items, [], 'b', -1, true)).toBe('a')
  })

  it('skips disabled neighbours', () => {
    expect(nextEnabled(items, ['c'], 'b', 1, true)).toBe('d')
    expect(nextEnabled(items, ['a'], 'b', -1, true)).toBe('d') // wraps past disabled 'a' to 'd'
  })

  it('wraps when loop=true', () => {
    expect(nextEnabled(items, [], 'd', 1, true)).toBe('a')
    expect(nextEnabled(items, [], 'a', -1, true)).toBe('d')
  })

  it('stops at the ends when loop=false', () => {
    expect(nextEnabled(items, [], 'd', 1, false)).toBeNull()
    expect(nextEnabled(items, [], 'a', -1, false)).toBeNull()
  })

  it('falls back to the first enabled when `from` is not present', () => {
    expect(nextEnabled(items, [], 'zzz', 1, true)).toBe('a')
  })

  it('returns null for an empty list', () => {
    expect(nextEnabled([], [], 'a', 1, true)).toBeNull()
  })
})

describe('resolveRovingMove (horizontal, default)', () => {
  const items: RovingItem[] = [{ value: 'a' }, { value: 'b' }, { value: 'c' }]

  it('ArrowRight / ArrowLeft resolve to the next / prev value', () => {
    expect(resolveRovingMove('ArrowRight', 'a', items)).toEqual({ type: 'focus', value: 'b' })
    expect(resolveRovingMove('ArrowLeft', 'b', items)).toEqual({ type: 'focus', value: 'a' })
  })

  it('Home / End resolve to the first / last value', () => {
    expect(resolveRovingMove('Home', 'c', items)).toEqual({ type: 'focus', value: 'a' })
    expect(resolveRovingMove('End', 'a', items)).toEqual({ type: 'focus', value: 'c' })
  })

  it('Enter and Space request activation', () => {
    expect(resolveRovingMove('Enter', 'a', items)).toEqual({ type: 'activate' })
    expect(resolveRovingMove(' ', 'a', items)).toEqual({ type: 'activate' })
  })

  it('vertical arrows are NOT navigation keys in horizontal mode', () => {
    expect(resolveRovingMove('ArrowDown', 'a', items)).toBeNull()
    expect(resolveRovingMove('ArrowUp', 'a', items)).toBeNull()
  })

  it('returns null for unrelated keys', () => {
    expect(resolveRovingMove('x', 'a', items)).toBeNull()
    expect(resolveRovingMove('Tab', 'a', items)).toBeNull()
  })

  it('wraps by default and skips disabled items', () => {
    const withDisabled: RovingItem[] = [
      { value: 'a' },
      { value: 'b', disabled: true },
      { value: 'c' },
    ]
    expect(resolveRovingMove('ArrowRight', 'a', withDisabled)).toEqual({
      type: 'focus',
      value: 'c',
    })
    expect(resolveRovingMove('ArrowRight', 'c', withDisabled)).toEqual({
      type: 'focus',
      value: 'a',
    })
  })

  it('honours loop=false at the boundaries', () => {
    expect(resolveRovingMove('ArrowRight', 'c', items, { loop: false })).toBeNull()
    expect(resolveRovingMove('ArrowLeft', 'a', items, { loop: false })).toBeNull()
  })
})

describe('resolveRovingMove (vertical)', () => {
  const items: RovingItem[] = [{ value: 'a' }, { value: 'b' }, { value: 'c' }]

  it('ArrowDown / ArrowUp navigate; Left/Right do not', () => {
    expect(resolveRovingMove('ArrowDown', 'a', items, { orientation: 'vertical' })).toEqual({
      type: 'focus',
      value: 'b',
    })
    expect(resolveRovingMove('ArrowUp', 'b', items, { orientation: 'vertical' })).toEqual({
      type: 'focus',
      value: 'a',
    })
    expect(resolveRovingMove('ArrowRight', 'a', items, { orientation: 'vertical' })).toBeNull()
    expect(resolveRovingMove('ArrowLeft', 'a', items, { orientation: 'vertical' })).toBeNull()
  })
})

describe('resolveRovingMove (RTL)', () => {
  it('flips ArrowLeft/ArrowRight when the element resolves to dir=rtl', () => {
    const host = document.createElement('div')
    host.setAttribute('dir', 'rtl')
    const tab = document.createElement('button')
    host.appendChild(tab)
    document.body.appendChild(host)
    const items: RovingItem[] = [{ value: 'a' }, { value: 'b' }, { value: 'c' }]

    // In RTL, pressing ArrowRight should move to the *previous* logical value.
    expect(resolveRovingMove('ArrowRight', 'b', items, { element: tab })).toEqual({
      type: 'focus',
      value: 'a',
    })
    expect(resolveRovingMove('ArrowLeft', 'b', items, { element: tab })).toEqual({
      type: 'focus',
      value: 'c',
    })
    host.remove()
  })
})

describe('focusRovingTab', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    container.setAttribute('role', 'tablist')
    for (const v of ['a', 'b', 'c']) {
      const b = document.createElement('button')
      b.setAttribute('role', 'tab')
      b.setAttribute('data-value', v)
      container.appendChild(b)
    }
    document.body.appendChild(container)
  })

  it('focuses the trigger whose data-value matches', () => {
    focusRovingTab(container, 'b')
    expect(document.activeElement).toBe(container.querySelector('[data-value="b"]'))
  })

  it('is a no-op when no trigger matches', () => {
    container.querySelector<HTMLElement>('[data-value="a"]')!.focus()
    focusRovingTab(container, 'nope')
    expect(document.activeElement).toBe(container.querySelector('[data-value="a"]'))
  })
})
