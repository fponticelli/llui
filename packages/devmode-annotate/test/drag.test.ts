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
      x: number
      y: number
    }
    expect(typeof saved.x).toBe('number')
    expect(typeof saved.y).toBe('number')
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

  it('restores saved position on next mount', () => {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x: 100, y: 200 }))
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.style.left).toBe('100px')
    expect(root.style.top).toBe('200px')
    expect(root.style.right).toBe('auto')
    expect(root.style.bottom).toBe('auto')
  })

  it('clamps a previously-saved off-screen position to the viewport', () => {
    // window.innerWidth/Height in jsdom default to 1024x768
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x: 100_000, y: -50 }))
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const x = parseInt(root.style.left, 10)
    const y = parseInt(root.style.top, 10)
    expect(x).toBeLessThan(window.innerWidth)
    expect(y).toBeGreaterThanOrEqual(0)
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
    const ta = document.querySelector('#llui-devmode-annotate-root textarea') as HTMLTextAreaElement
    return ta.parentElement!
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
})
