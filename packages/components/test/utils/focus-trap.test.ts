import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pushFocusTrap, _focusTrapStackSize } from '../../src/utils/focus-trap'

describe('pushFocusTrap()', () => {
  let outside: HTMLButtonElement
  let container: HTMLDivElement
  let btnA: HTMLButtonElement
  let btnB: HTMLButtonElement
  let btnC: HTMLButtonElement

  beforeEach(() => {
    outside = document.createElement('button')
    outside.textContent = 'outside'
    container = document.createElement('div')
    btnA = document.createElement('button')
    btnA.textContent = 'A'
    btnB = document.createElement('button')
    btnB.textContent = 'B'
    btnC = document.createElement('button')
    btnC.textContent = 'C'
    container.append(btnA, btnB, btnC)
    document.body.append(outside, container)
    outside.focus()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function tab(shift = false): void {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(event)
  }

  it('focuses first focusable on activation', () => {
    const cleanup = pushFocusTrap({ container })
    expect(document.activeElement).toBe(btnA)
    cleanup()
  })

  it('focuses explicit initialFocus', () => {
    const cleanup = pushFocusTrap({ container, initialFocus: btnB })
    expect(document.activeElement).toBe(btnB)
    cleanup()
  })

  it('wraps from last to first on Tab', () => {
    const cleanup = pushFocusTrap({ container })
    btnC.focus()
    tab(false)
    expect(document.activeElement).toBe(btnA)
    cleanup()
  })

  it('wraps from first to last on Shift+Tab', () => {
    const cleanup = pushFocusTrap({ container })
    btnA.focus()
    tab(true)
    expect(document.activeElement).toBe(btnC)
    cleanup()
  })

  it('restores focus on cleanup', () => {
    const cleanup = pushFocusTrap({ container })
    expect(document.activeElement).toBe(btnA)
    cleanup()
    expect(document.activeElement).toBe(outside)
  })

  it('does not restore when restoreFocus=false', () => {
    const cleanup = pushFocusTrap({ container, restoreFocus: false })
    cleanup()
    expect(document.activeElement).toBe(btnA)
  })

  it('nesting: inner trap handles Tab', () => {
    const outer = pushFocusTrap({ container })
    const inner = document.createElement('div')
    const innerBtn1 = document.createElement('button')
    const innerBtn2 = document.createElement('button')
    inner.append(innerBtn1, innerBtn2)
    document.body.appendChild(inner)
    const innerTrap = pushFocusTrap({ container: inner })
    expect(document.activeElement).toBe(innerBtn1)
    innerBtn2.focus()
    tab(false)
    expect(document.activeElement).toBe(innerBtn1)
    innerTrap()
    outer()
  })

  it('tracks stack size', () => {
    expect(_focusTrapStackSize()).toBe(0)
    const cleanup = pushFocusTrap({ container })
    expect(_focusTrapStackSize()).toBe(1)
    cleanup()
    expect(_focusTrapStackSize()).toBe(0)
  })
})
