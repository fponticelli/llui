import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pushDismissable, _dismissableStackSize } from '../../src/utils/dismissable'

describe('pushDismissable()', () => {
  let container: HTMLElement
  let outside: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    outside = document.createElement('div')
    document.body.append(container, outside)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function dispatchKey(key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true })
    document.dispatchEvent(event)
    return event
  }

  it('calls onDismiss with "escape" on Esc', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({ element: container, onDismiss })
    dispatchKey('Escape')
    expect(onDismiss).toHaveBeenCalledWith('escape', expect.any(Object))
    cleanup()
  })

  it('calls onDismiss with "outside" on pointerdown outside', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({ element: container, onDismiss })
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onDismiss).toHaveBeenCalledWith('outside', expect.any(Object))
    cleanup()
  })

  it('does not fire on pointerdown inside', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({ element: container, onDismiss })
    container.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    cleanup()
  })

  it('ignores other keys', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({ element: container, onDismiss })
    dispatchKey('Enter')
    expect(onDismiss).not.toHaveBeenCalled()
    cleanup()
  })

  it('only the topmost layer receives escape', () => {
    const onA = vi.fn()
    const onB = vi.fn()
    const ca = pushDismissable({ element: container, onDismiss: onA })
    const cb = pushDismissable({ element: outside, onDismiss: onB })
    dispatchKey('Escape')
    expect(onA).not.toHaveBeenCalled()
    expect(onB).toHaveBeenCalledTimes(1)
    cb()
    dispatchKey('Escape')
    expect(onA).toHaveBeenCalledTimes(1)
    ca()
  })

  it('disableEscape suppresses escape dismissal but keeps outside', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({
      element: container,
      onDismiss,
      disableEscape: true,
    })
    dispatchKey('Escape')
    expect(onDismiss).not.toHaveBeenCalled()
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('disableOutside suppresses outside dismissal but keeps escape', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({
      element: container,
      onDismiss,
      disableOutside: true,
    })
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()
    dispatchKey('Escape')
    expect(onDismiss).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('cleanup removes layer from stack', () => {
    const onDismiss = vi.fn()
    const cleanup = pushDismissable({ element: container, onDismiss })
    expect(_dismissableStackSize()).toBe(1)
    cleanup()
    expect(_dismissableStackSize()).toBe(0)
  })
})
