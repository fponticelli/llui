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
})
