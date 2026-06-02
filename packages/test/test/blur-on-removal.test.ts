import { describe, it, expect, afterEach } from 'vitest'
import { emulateBlurOnRemoval, withBlurOnRemoval } from '../src/blur-on-removal'

// The helper exists to repair a specific jsdom divergence from real browsers:
// removing a focused element fires no blur/focusout, whereas browsers run the
// HTML "removing steps" focus fixup synchronously. These tests pin the contract
// the runtime + app regression tests rely on.

describe('emulateBlurOnRemoval', () => {
  let uninstall: (() => void) | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
    document.body.innerHTML = ''
  })

  it('baseline: jsdom does NOT fire blur on removeChild (the gap we are closing)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const input = document.createElement('input')
    host.appendChild(input)
    let blurred = false
    input.addEventListener('blur', () => (blurred = true))
    input.focus()
    expect(document.activeElement).toBe(input)

    host.removeChild(input)
    expect(blurred).toBe(false) // <- the divergence; activeElement still resets
    expect(document.activeElement).toBe(document.body)
  })

  it('fires blur then focusout synchronously when the focused node is removed', () => {
    uninstall = emulateBlurOnRemoval()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const input = document.createElement('input')
    host.appendChild(input)
    const seq: string[] = []
    input.addEventListener('blur', () => seq.push('blur'))
    input.addEventListener('focusout', () => seq.push('focusout'))
    input.focus()

    host.removeChild(input)
    expect(seq).toEqual(['blur', 'focusout']) // browser order, synchronous
  })

  it('fires when an ANCESTOR of the focused node is removed (subtree removal)', () => {
    uninstall = emulateBlurOnRemoval()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const arm = document.createElement('div')
    const input = document.createElement('input')
    arm.appendChild(input)
    host.appendChild(arm)
    let blurred = false
    input.addEventListener('blur', () => (blurred = true))
    input.focus()

    host.removeChild(arm) // removing the wrapper must still blur the inner input
    expect(blurred).toBe(true)
  })

  it('does NOT fire when removing an unfocused node, or when focus is on <body>', () => {
    uninstall = emulateBlurOnRemoval()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const focused = document.createElement('input')
    const other = document.createElement('input')
    host.append(focused, other)
    let otherBlurred = false
    let focusedBlurred = false
    other.addEventListener('blur', () => (otherBlurred = true))
    focused.addEventListener('blur', () => (focusedBlurred = true))
    focused.focus()

    host.removeChild(other) // unrelated node — no blur for anyone
    expect(otherBlurred).toBe(false)
    expect(focusedBlurred).toBe(false)
  })

  it('also covers Element.remove() and replaceChild()', () => {
    uninstall = emulateBlurOnRemoval()
    const host = document.createElement('div')
    document.body.appendChild(host)

    const a = document.createElement('input')
    host.appendChild(a)
    let aBlur = false
    a.addEventListener('blur', () => (aBlur = true))
    a.focus()
    a.remove()
    expect(aBlur).toBe(true)

    const b = document.createElement('input')
    host.appendChild(b)
    let bBlur = false
    b.addEventListener('blur', () => (bBlur = true))
    b.focus()
    host.replaceChild(document.createElement('span'), b)
    expect(bBlur).toBe(true)
  })

  it('uninstall restores the native methods (no leak across tests)', () => {
    const u = emulateBlurOnRemoval()
    u()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const input = document.createElement('input')
    host.appendChild(input)
    let blurred = false
    input.addEventListener('blur', () => (blurred = true))
    input.focus()
    host.removeChild(input)
    expect(blurred).toBe(false) // back to jsdom default
  })

  it('withBlurOnRemoval scopes the patch and uninstalls even on throw', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const input = document.createElement('input')
    host.appendChild(input)
    let blurred = false
    input.addEventListener('blur', () => (blurred = true))
    input.focus()

    expect(() =>
      withBlurOnRemoval(() => {
        host.removeChild(input)
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(blurred).toBe(true)

    // Patch is gone after the scope.
    const i2 = document.createElement('input')
    host.appendChild(i2)
    let b2 = false
    i2.addEventListener('blur', () => (b2 = true))
    i2.focus()
    host.removeChild(i2)
    expect(b2).toBe(false)
  })
})
