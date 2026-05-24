/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drawRect } from '../src/overlay.js'

function dispatchMouse(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('drawRect overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts a fullscreen overlay layer', () => {
    void drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.style.position).toBe('fixed')
  })

  it('resolves with the drawn rect on mousedown→mousemove→mouseup', async () => {
    const promise = drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 100, 80)
    dispatchMouse(overlay, 'mousemove', 250, 200)
    dispatchMouse(overlay, 'mouseup', 250, 200)
    const result = await promise
    expect(result.reason).toBe('submit')
    expect(result.rect).toEqual({ x: 100, y: 80, w: 150, h: 120 })
  })

  it('handles reverse-direction drag (right-to-left, bottom-to-top)', async () => {
    const promise = drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 300, 250)
    dispatchMouse(overlay, 'mousemove', 100, 80)
    dispatchMouse(overlay, 'mouseup', 100, 80)
    const result = await promise
    expect(result.reason).toBe('submit')
    expect(result.rect).toEqual({ x: 100, y: 80, w: 200, h: 170 })
  })

  it('resolves with reason:cancel on Escape', async () => {
    const promise = drawRect()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const result = await promise
    expect(result.reason).toBe('cancel')
    expect(result.rect).toBe(null)
  })

  it('treats a tiny drag (<4px) as cancel', async () => {
    const promise = drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 100, 100)
    dispatchMouse(overlay, 'mousemove', 102, 101)
    dispatchMouse(overlay, 'mouseup', 102, 101)
    const result = await promise
    expect(result.reason).toBe('cancel')
  })

  it('removes its DOM on completion', async () => {
    const promise = drawRect()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
    expect(document.querySelector('[data-llui-overlay="rect"]')).toBeNull()
  })
})
