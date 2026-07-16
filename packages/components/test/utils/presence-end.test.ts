import { describe, it, expect, vi } from 'vitest'
import { presenceEndHandler } from '../../src/utils/presence-end'

describe('presenceEndHandler', () => {
  it('fires the handler for the element the listener is bound to', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const spy = vi.fn()
    parent.addEventListener('animationend', presenceEndHandler(spy))

    parent.dispatchEvent(new Event('animationend', { bubbles: true }))

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ignores an animationend bubbling up from a descendant', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    parent.appendChild(child)
    document.body.appendChild(parent)
    const spy = vi.fn()
    parent.addEventListener('animationend', presenceEndHandler(spy))

    // A child animation ending during the exit phase must NOT advance presence.
    child.dispatchEvent(new Event('animationend', { bubbles: true }))

    expect(spy).not.toHaveBeenCalled()
  })

  it('ignores a bubbling child transitionend but honors the parent’s own', () => {
    const parent = document.createElement('div')
    const child = document.createElement('div')
    parent.appendChild(child)
    document.body.appendChild(parent)
    const spy = vi.fn()
    parent.addEventListener('transitionend', presenceEndHandler(spy))

    child.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(spy).not.toHaveBeenCalled()

    parent.dispatchEvent(new Event('transitionend', { bubbles: true }))
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
