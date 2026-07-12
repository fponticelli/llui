/// <reference lib="dom" />
// Tests for the floating-button drag + position-persist behavior.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

const POSITION_KEY = 'llui-devmode-annotate.position'

function dispatchPointer(target: Element, type: string, x: number, y: number): void {
  // jsdom doesn't ship a PointerEvent constructor in all versions —
  // synthesize the event with MouseEvent shape + pointer-event type
  // so the listeners fire. setPointerCapture is try/caught in the
  // implementation.
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  })
  ;(event as unknown as { pointerId: number }).pointerId = 1
  target.dispatchEvent(event)
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.removeItem(POSITION_KEY)
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.removeItem(POSITION_KEY)
})

describe('floating button — drag + persist', () => {
  it('does not move when pointerdown→up without drag past threshold', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!
    const beforeLeft = root.style.left
    dispatchPointer(btn, 'pointerdown', 100, 100)
    dispatchPointer(btn, 'pointermove', 101, 101)
    dispatchPointer(btn, 'pointerup', 101, 101)
    expect(root.style.left).toBe(beforeLeft) // unchanged
    expect(localStorage.getItem(POSITION_KEY)).toBeNull()
  })

  it('persists position on drag past threshold', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!
    // jsdom: getBoundingClientRect returns 0 for unrendered elements,
    // so the drag delta maps to absolute coordinates from origin.
    dispatchPointer(btn, 'pointerdown', 100, 100)
    dispatchPointer(btn, 'pointermove', 200, 250)
    dispatchPointer(btn, 'pointerup', 200, 250)
    expect(root.style.left).not.toBe('')
    expect(root.style.top).not.toBe('')
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY)!) as {
      anchorX: 'left' | 'right'
      offsetX: number
      anchorY: 'top' | 'bottom'
      offsetY: number
    }
    expect(['left', 'right']).toContain(saved.anchorX)
    expect(['top', 'bottom']).toContain(saved.anchorY)
    expect(typeof saved.offsetX).toBe('number')
    expect(typeof saved.offsetY).toBe('number')
  })

  it('a real drag suppresses the trailing click — modal stays closed', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!
    const modal = root.querySelectorAll('div')[0]! // First div is the modal
    // Sanity: modal starts hidden
    dispatchPointer(btn, 'pointerdown', 100, 100)
    dispatchPointer(btn, 'pointermove', 200, 250)
    dispatchPointer(btn, 'pointerup', 200, 250)
    // Simulate the synthesized click that follows pointerup
    btn.click()
    // Modal still hidden because the drag installed a capturing
    // click handler that eats the event
    // (jsdom may or may not fire the click anyway; what we really
    // assert is "no toggle happened").
    expect(modal.style.display === 'block').toBe(false)
  })

  // Finding 11 — the trailing-click suppression must not go stale: a LATER
  // legitimate click (after the drag's microtask) must still open the modal.
  it('a click after the drag settles still opens the modal', async () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!
    const modal = root.querySelector('[data-llui-modal]') as HTMLElement
    dispatchPointer(btn, 'pointerdown', 100, 100)
    dispatchPointer(btn, 'pointermove', 200, 250)
    dispatchPointer(btn, 'pointerup', 200, 250)
    // The immediate synthesized click is swallowed.
    btn.click()
    expect(modal.style.display === 'block').toBe(false)
    // After the microtask clears `justDragged`, a fresh click opens the modal —
    // the old one-shot capture listener would have lingered and eaten this one.
    await Promise.resolve()
    btn.click()
    expect(modal.style.display).toBe('block')
  })

  it('pointercancel after a drag persists the position (same path as pointerup)', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!
    dispatchPointer(btn, 'pointerdown', 100, 100)
    dispatchPointer(btn, 'pointermove', 220, 260)
    // Cancelled instead of a clean pointerup — must still persist + reanchor.
    dispatchPointer(btn, 'pointercancel', 220, 260)
    expect(localStorage.getItem(POSITION_KEY)).not.toBeNull()
  })

  it('restores a left/top-anchored saved position on next mount', () => {
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ anchorX: 'left', offsetX: 100, anchorY: 'top', offsetY: 200 }),
    )
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.style.left).toBe('100px')
    expect(root.style.top).toBe('200px')
    expect(root.style.right).toBe('auto')
    expect(root.style.bottom).toBe('auto')
  })

  it('restores a right/bottom-anchored saved position on next mount', () => {
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ anchorX: 'right', offsetX: 50, anchorY: 'bottom', offsetY: 80 }),
    )
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.style.right).toBe('50px')
    expect(root.style.bottom).toBe('80px')
    expect(root.style.left).toBe('auto')
    expect(root.style.top).toBe('auto')
  })

  it('clamps a previously-saved off-screen position to the viewport', () => {
    // window.innerWidth/Height in jsdom default to 1024x768
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ anchorX: 'left', offsetX: 100_000, anchorY: 'top', offsetY: -50 }),
    )
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const x = parseInt(root.style.left, 10)
    const y = parseInt(root.style.top, 10)
    expect(x).toBeLessThan(window.innerWidth)
    expect(y).toBeGreaterThanOrEqual(0)
  })

  it('right-anchored button tracks the right edge across window resize', () => {
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ anchorX: 'right', offsetX: 50, anchorY: 'bottom', offsetY: 50 }),
    )
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.style.right).toBe('50px')
    expect(root.style.bottom).toBe('50px')

    // Shrink the viewport; right/bottom-anchored values are preserved
    // so the button visually follows the new edge.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    window.dispatchEvent(new Event('resize'))

    expect(root.style.right).toBe('50px')
    expect(root.style.bottom).toBe('50px')
    expect(root.style.left).toBe('auto')
    expect(root.style.top).toBe('auto')
  })

  it('left-anchored button clamps inward on viewport shrink so it stays visible', () => {
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ anchorX: 'left', offsetX: 900, anchorY: 'top', offsetY: 700 }),
    )
    // Start with a viewport large enough to honor the offsets verbatim.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.style.left).toBe('900px')
    expect(root.style.top).toBe('700px')

    // Shrink so the saved offset would put the button off-screen.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    window.dispatchEvent(new Event('resize'))

    const x = parseInt(root.style.left, 10)
    const y = parseInt(root.style.top, 10)
    expect(x + 44).toBeLessThanOrEqual(400)
    expect(y + 44).toBeLessThanOrEqual(300)
  })

  it('ignores corrupted localStorage payload', () => {
    localStorage.setItem(POSITION_KEY, 'not json')
    expect(() => mountAnnotateHud({ subscribeEvents: false })).not.toThrow()
    const root = document.getElementById('llui-devmode-annotate-root')!
    // Default position (no left/top inline) — corruption silently
    // ignored, button falls back to bottom-right via CSS.
    expect(root.style.left).toBe('')
  })
})

describe('modal repositioning when clipped', () => {
  // jsdom doesn't compute layout, so we stub getBoundingClientRect on
  // the root container to drive the reanchor logic from controlled
  // values. modal.offsetWidth/offsetHeight default to 0 in jsdom; the
  // implementation falls back to 360 / 320 in that case, so a button
  // at x<360 should trigger a horizontal flip.

  function stubRootRect(rect: {
    left: number
    top: number
    width?: number
    height?: number
  }): void {
    const root = document.getElementById('llui-devmode-annotate-root')!
    const w = rect.width ?? 44
    const h = rect.height ?? 44
    root.getBoundingClientRect = () =>
      ({
        left: rect.left,
        top: rect.top,
        right: rect.left + w,
        bottom: rect.top + h,
        width: w,
        height: h,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect
  }

  function getModal(): HTMLElement {
    return document.querySelector('#llui-devmode-annotate-root [data-llui-modal]') as HTMLElement
  }

  it('keeps right-anchor when the button sits in the right half of a wide viewport', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    stubRootRect({ left: 900, top: 600 })
    handle.open()
    await new Promise((r) => setTimeout(r, 0))
    const modal = getModal()
    // rightAnchoredLeft = 944 - 360 = 584 > 8 → keep right-anchor
    expect(modal.style.right).toBe('0px')
    expect(modal.style.left).toBe('auto')
  })

  it('flips horizontal anchor when the button sits near the left edge', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    stubRootRect({ left: 16, top: 600 })
    handle.open()
    await new Promise((r) => setTimeout(r, 0))
    const modal = getModal()
    // rightAnchoredLeft = 60 - 360 = -300 < 8 → flip to left-anchor
    expect(modal.style.left).toBe('0px')
    expect(modal.style.right).toBe('auto')
  })

  it('flips vertical anchor when the button sits near the top', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    stubRootRect({ left: 900, top: 16 })
    handle.open()
    await new Promise((r) => setTimeout(r, 0))
    const modal = getModal()
    // aboveTop = 16 - 320 - 8 = -312 < 8 → place modal below the button
    expect(modal.style.top).toBe('56px')
    expect(modal.style.bottom).toBe('auto')
  })

  it('reanchors live during drag when the modal is open', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    handle.open()
    await new Promise((r) => setTimeout(r, 0))
    const modal = getModal()
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = root.querySelector('button')!

    // Drag the button toward the left edge. The root's stub rect
    // updates as we set inline style — but jsdom's
    // getBoundingClientRect doesn't reflect that, so we restub on the
    // fly to model "button moved to x=20".
    let leftStub = 900
    root.getBoundingClientRect = () =>
      ({
        left: leftStub,
        top: 600,
        right: leftStub + 44,
        bottom: 644,
        width: 44,
        height: 44,
        x: leftStub,
        y: 600,
        toJSON: () => ({}),
      }) as DOMRect

    // Start drag at (900, 600); move past threshold to (20, 600).
    const fire = (type: string, x: number, y: number): void => {
      const ev = new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
      ;(ev as unknown as { pointerId: number }).pointerId = 1
      btn.dispatchEvent(ev)
    }
    fire('pointerdown', 900, 600)
    // Update stub to track the drag — the move handler reads
    // getBoundingClientRect when calling reanchorModal.
    leftStub = 20
    fire('pointermove', 20, 600)
    // Modal should have flipped to left-anchor mid-drag.
    expect(modal.style.left).toBe('0px')
    expect(modal.style.right).toBe('auto')
    fire('pointerup', 20, 600)
  })
})
