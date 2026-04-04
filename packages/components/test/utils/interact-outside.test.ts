import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { watchInteractOutside } from '../../src/utils/interact-outside'

describe('watchInteractOutside()', () => {
  let container: HTMLElement
  let outside: HTMLElement
  let trigger: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    container.id = 'inside'
    const child = document.createElement('span')
    child.id = 'inside-child'
    container.appendChild(child)

    outside = document.createElement('div')
    outside.id = 'outside'

    trigger = document.createElement('button')
    trigger.id = 'trigger'

    document.body.append(container, outside, trigger)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function dispatchPointerDown(target: Element): void {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  }

  it('fires on pointerdown outside element', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })
    dispatchPointerDown(outside)
    expect(onInteractOutside).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('does not fire on pointerdown inside element', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })
    dispatchPointerDown(container.firstElementChild!)
    expect(onInteractOutside).not.toHaveBeenCalled()
    cleanup()
  })

  it('does not fire when target is in ignore list', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({
      element: container,
      ignore: [trigger],
      onInteractOutside,
    })
    dispatchPointerDown(trigger)
    expect(onInteractOutside).not.toHaveBeenCalled()
    cleanup()
  })

  it('accepts an element accessor function', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({
      element: () => container,
      onInteractOutside,
    })
    dispatchPointerDown(outside)
    expect(onInteractOutside).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('fires on focusin outside', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })
    outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(onInteractOutside).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('shouldDispatch=false suppresses callback', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({
      element: container,
      shouldDispatch: () => false,
      onInteractOutside,
    })
    dispatchPointerDown(outside)
    expect(onInteractOutside).not.toHaveBeenCalled()
    cleanup()
  })

  it('cleanup removes listeners', () => {
    const onInteractOutside = vi.fn()
    const cleanup = watchInteractOutside({ element: container, onInteractOutside })
    cleanup()
    dispatchPointerDown(outside)
    expect(onInteractOutside).not.toHaveBeenCalled()
  })
})
