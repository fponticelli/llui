import { describe, it, expect, afterEach } from 'vitest'
import { resolveDir, flipArrow, resolveTextDirection } from '../../src/utils/direction'

describe('resolveDir', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('returns ltr by default', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveDir(el)).toBe('ltr')
    el.remove()
  })

  it('detects rtl from ancestor dir attribute', () => {
    const container = document.createElement('div')
    container.setAttribute('dir', 'rtl')
    const el = document.createElement('div')
    container.appendChild(el)
    document.body.appendChild(container)
    expect(resolveDir(el)).toBe('rtl')
    container.remove()
  })

  it('detects rtl from documentElement', () => {
    document.documentElement.dir = 'rtl'
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(resolveDir(el)).toBe('rtl')
    el.remove()
  })

  it('nearest dir attribute wins', () => {
    const outer = document.createElement('div')
    outer.setAttribute('dir', 'rtl')
    const inner = document.createElement('div')
    inner.setAttribute('dir', 'ltr')
    const el = document.createElement('div')
    inner.appendChild(el)
    outer.appendChild(inner)
    document.body.appendChild(outer)
    expect(resolveDir(el)).toBe('ltr')
    outer.remove()
  })
})

describe('flipArrow', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('returns arrow unchanged in ltr', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(flipArrow('ArrowLeft', el)).toBe('ArrowLeft')
    expect(flipArrow('ArrowRight', el)).toBe('ArrowRight')
    el.remove()
  })

  it('swaps ArrowLeft and ArrowRight in rtl', () => {
    document.documentElement.dir = 'rtl'
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(flipArrow('ArrowLeft', el)).toBe('ArrowRight')
    expect(flipArrow('ArrowRight', el)).toBe('ArrowLeft')
    el.remove()
  })

  it('does not change vertical arrows in rtl', () => {
    document.documentElement.dir = 'rtl'
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(flipArrow('ArrowUp', el)).toBe('ArrowUp')
    expect(flipArrow('ArrowDown', el)).toBe('ArrowDown')
    el.remove()
  })

  it('does not change non-arrow keys', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    expect(flipArrow('Enter', el)).toBe('Enter')
    expect(flipArrow('Tab', el)).toBe('Tab')
    el.remove()
  })

  describe('explicit direction (overrides DOM)', () => {
    it('returns arrow unchanged for explicit ltr', () => {
      expect(flipArrow('ArrowLeft', 'ltr')).toBe('ArrowLeft')
      expect(flipArrow('ArrowRight', 'ltr')).toBe('ArrowRight')
    })

    it('swaps horizontal arrows for explicit rtl', () => {
      expect(flipArrow('ArrowLeft', 'rtl')).toBe('ArrowRight')
      expect(flipArrow('ArrowRight', 'rtl')).toBe('ArrowLeft')
    })

    it('does not flip vertical/Home/End/PageUp/PageDown under explicit rtl', () => {
      expect(flipArrow('ArrowUp', 'rtl')).toBe('ArrowUp')
      expect(flipArrow('ArrowDown', 'rtl')).toBe('ArrowDown')
      expect(flipArrow('Home', 'rtl')).toBe('Home')
      expect(flipArrow('End', 'rtl')).toBe('End')
      expect(flipArrow('PageUp', 'rtl')).toBe('PageUp')
      expect(flipArrow('PageDown', 'rtl')).toBe('PageDown')
    })

    it('explicit rtl wins over an ltr DOM context', () => {
      // Element is ltr by default; explicit rtl still flips.
      const el = document.createElement('div')
      document.body.appendChild(el)
      expect(flipArrow('ArrowLeft', 'rtl')).toBe('ArrowRight')
      el.remove()
    })

    it('null source is treated as ltr', () => {
      expect(flipArrow('ArrowLeft', null)).toBe('ArrowLeft')
    })
  })
})

describe('resolveTextDirection', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('returns explicit ltr/rtl directly', () => {
    expect(resolveTextDirection('ltr')).toBe('ltr')
    expect(resolveTextDirection('rtl')).toBe('rtl')
  })

  it('defaults null/undefined to ltr', () => {
    expect(resolveTextDirection(null)).toBe('ltr')
    expect(resolveTextDirection(undefined)).toBe('ltr')
  })

  it('resolves an element from the DOM', () => {
    const container = document.createElement('div')
    container.setAttribute('dir', 'rtl')
    const el = document.createElement('div')
    container.appendChild(el)
    document.body.appendChild(container)
    expect(resolveTextDirection(el)).toBe('rtl')
    container.remove()
  })
})
