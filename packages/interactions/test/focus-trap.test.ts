import { afterEach, describe, expect, it } from 'vitest'
import { pushFocusTrap } from '../src/index'

describe('pushFocusTrap', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps focus in place and prevents Tab when the trap has no tab-reachable descendants', () => {
    const outside = document.createElement('button')
    const container = document.createElement('div')
    container.innerHTML = '<button tabindex="-1">Programmatic item</button>'
    document.body.append(outside, container)
    outside.focus()

    const release = pushFocusTrap({ container, restoreFocus: false })
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(outside)
    release()
  })

  // #265 H2: a modal with nothing focusable inside (a registry Drawer with no
  // close button) left focus on <body>, outside the modal. The WAI-ARIA dialog
  // pattern focuses the dialog itself then; the content parts carry
  // `tabindex="-1"` for exactly that.
  it('focuses the container itself when it holds nothing focusable', () => {
    const container = document.createElement('div')
    container.tabIndex = -1
    container.append(document.createElement('p'))
    document.body.append(container)
    const release = pushFocusTrap({ container })
    expect(document.activeElement).toBe(container)
    release()
    container.remove()
  })

  it('still prefers the first focusable descendant over the container', () => {
    const container = document.createElement('div')
    container.tabIndex = -1
    const button = document.createElement('button')
    container.append(button)
    document.body.append(container)
    const release = pushFocusTrap({ container })
    expect(document.activeElement).toBe(button)
    release()
    container.remove()
  })
})
