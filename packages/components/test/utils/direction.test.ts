import { describe, it, expect, afterEach } from 'vitest'
import { resolveDir, flipArrow } from '../../src/utils/direction'

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
})
