import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setAriaHiddenOutside } from '../../src/utils/aria-hidden'

describe('setAriaHiddenOutside()', () => {
  let target: HTMLElement
  let sibling1: HTMLElement
  let sibling2: HTMLElement
  let uncle: HTMLElement

  beforeEach(() => {
    const parent = document.createElement('div')
    target = document.createElement('div')
    target.id = 'target'
    sibling1 = document.createElement('div')
    sibling1.id = 'sib1'
    sibling2 = document.createElement('div')
    sibling2.id = 'sib2'
    parent.append(sibling1, target, sibling2)

    uncle = document.createElement('div')
    uncle.id = 'uncle'

    document.body.append(parent, uncle)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hides siblings up the tree', () => {
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    expect(sibling2.getAttribute('aria-hidden')).toBe('true')
    expect(uncle.getAttribute('aria-hidden')).toBe('true')
    expect(target.getAttribute('aria-hidden')).toBeNull()
    cleanup()
  })

  it('applies inert alongside aria-hidden', () => {
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('restores original attributes on cleanup', () => {
    sibling1.setAttribute('aria-hidden', 'false')
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    cleanup()
    expect(sibling1.getAttribute('aria-hidden')).toBe('false')
    expect(sibling1.hasAttribute('inert')).toBe(false)
  })

  it('removes attributes that were absent', () => {
    const cleanup = setAriaHiddenOutside(target)
    cleanup()
    expect(sibling1.hasAttribute('aria-hidden')).toBe(false)
    expect(sibling1.hasAttribute('inert')).toBe(false)
  })

  it('reference-counts nested calls', () => {
    const cleanupA = setAriaHiddenOutside(target)
    const cleanupB = setAriaHiddenOutside(target)
    cleanupA()
    // Still hidden because second call holds reference
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    cleanupB()
    expect(sibling1.hasAttribute('aria-hidden')).toBe(false)
  })

  it('skips script/style siblings', () => {
    const parent = target.parentElement!
    const scriptEl = document.createElement('script')
    parent.appendChild(scriptEl)
    const cleanup = setAriaHiddenOutside(target)
    expect(scriptEl.hasAttribute('aria-hidden')).toBe(false)
    cleanup()
  })
})
