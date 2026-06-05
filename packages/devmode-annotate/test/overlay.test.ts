/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testComponent, reducer } from '@llui/test'
import {
  drawRect,
  rectInit,
  rectReduce,
  type RectState,
  type RectMsg,
  type RectEffect,
} from '../src/overlay.js'

const rectDef = reducer<RectState, RectMsg, RectEffect>({
  init: () => [rectInit(), []],
  update: rectReduce,
})

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

  it('removes its DOM on Escape cancellation', async () => {
    const promise = drawRect()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
    expect(document.querySelector('[data-llui-overlay="rect"]')).toBeNull()
  })

  it('keeps the overlay visible after a successful drag — caller calls dismiss()', async () => {
    const promise = drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 50, 50)
    dispatchMouse(overlay, 'mousemove', 150, 150)
    dispatchMouse(overlay, 'mouseup', 150, 150)
    const result = await promise

    expect(result.reason).toBe('submit')
    // Overlay still in the DOM — shows the highlighted rect while the
    // modal asks for confirmation.
    expect(document.querySelector('[data-llui-overlay="rect"]')).not.toBeNull()
    // Pointer-events disabled so clicks pass through to the modal.
    expect(overlay.style.pointerEvents).toBe('none')

    // The caller dismisses when the user submits/cancels in the modal.
    result.dismiss()
    expect(document.querySelector('[data-llui-overlay="rect"]')).toBeNull()
  })

  it('dismiss() is idempotent', async () => {
    const promise = drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 50, 50)
    dispatchMouse(overlay, 'mousemove', 100, 100)
    dispatchMouse(overlay, 'mouseup', 100, 100)
    const result = await promise
    result.dismiss()
    result.dismiss() // no-op; should not throw
    expect(document.querySelector('[data-llui-overlay="rect"]')).toBeNull()
  })

  it('hint fades out after the configured ms', async () => {
    const promise = drawRect({ hintFadeMs: 30 })
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    const hint = overlay.querySelector('div') as HTMLElement
    expect(hint.style.opacity).toBe('1')
    await new Promise((r) => setTimeout(r, 60))
    expect(hint.style.opacity).toBe('0')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
  })

  it('hint fades immediately on first mousedown', async () => {
    const promise = drawRect({ hintFadeMs: 10000 })
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    const hint = overlay.querySelector('div') as HTMLElement
    expect(hint.style.opacity).toBe('1')
    dispatchMouse(overlay, 'mousedown', 10, 10)
    expect(hint.style.opacity).toBe('0')
    dispatchMouse(overlay, 'mouseup', 10, 10)
    await promise
  })
})

// Idiomatic LLui: the drag logic is a pure reducer, testable at the message
// level via @llui/test with no DOM/jsdom at all.
describe('rect overlay reducer', () => {
  it('initialises idle with the hint visible', () => {
    const h = testComponent(rectDef)
    expect(h.state.phase).toBe('idle')
    expect(h.state.hintVisible).toBe(true)
    expect(h.state.rect).toBe(null)
  })

  it('down→move computes the rect and hides the hint', () => {
    const h = testComponent(rectDef)
    h.send({ type: 'down', x: 100, y: 80 })
    expect(h.state.phase).toBe('drawing')
    expect(h.state.hintVisible).toBe(false)
    h.send({ type: 'move', x: 250, y: 200 })
    expect(h.state.rect).toEqual({ x: 100, y: 80, w: 150, h: 120 })
  })

  it('normalises a reverse-direction drag', () => {
    const h = testComponent(rectDef)
    h.sendAll([
      { type: 'down', x: 300, y: 250 },
      { type: 'move', x: 100, y: 80 },
    ])
    expect(h.state.rect).toEqual({ x: 100, y: 80, w: 200, h: 170 })
  })

  it('up on a real drag emits resolve:submit with the rect', () => {
    const h = testComponent(rectDef)
    h.sendAll([{ type: 'down', x: 50, y: 50 }, { type: 'move', x: 150, y: 150 }, { type: 'up' }])
    expect(h.state.phase).toBe('captured')
    expect(h.effects).toEqual([
      { type: 'resolve', rect: { x: 50, y: 50, w: 100, h: 100 }, reason: 'submit' },
    ])
  })

  it('up on a tiny (<4px) drag emits resolve:cancel', () => {
    const h = testComponent(rectDef)
    h.sendAll([{ type: 'down', x: 100, y: 100 }, { type: 'move', x: 102, y: 101 }, { type: 'up' }])
    expect(h.effects).toEqual([{ type: 'resolve', rect: null, reason: 'cancel' }])
  })

  it('escape emits resolve:cancel', () => {
    const h = testComponent(rectDef)
    h.send({ type: 'escape' })
    expect(h.effects).toEqual([{ type: 'resolve', rect: null, reason: 'cancel' }])
  })

  it('move before down is ignored', () => {
    const h = testComponent(rectDef)
    h.send({ type: 'move', x: 10, y: 10 })
    expect(h.state.phase).toBe('idle')
    expect(h.state.rect).toBe(null)
  })
})
