import { describe, it, expect, vi } from 'vitest'
import { pointerDragHandlers } from '../../src/utils/pointer-drag'

function mockTarget(hasCapture = false): {
  setPointerCapture: ReturnType<typeof vi.fn>
  hasPointerCapture: ReturnType<typeof vi.fn>
  releasePointerCapture: ReturnType<typeof vi.fn>
} {
  return {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => hasCapture),
    releasePointerCapture: vi.fn(),
  }
}

function pointerEvent(overrides: {
  button?: number
  pointerId?: number
  clientX?: number
  clientY?: number
  currentTarget?: unknown
}): PointerEvent {
  return {
    button: overrides.button ?? 0,
    pointerId: overrides.pointerId ?? 1,
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
    currentTarget: overrides.currentTarget ?? mockTarget(),
  } as unknown as PointerEvent
}

describe('pointerDragHandlers', () => {
  it('pointerdown (primary button, enabled): captures, calls onDragStart then onDrag', () => {
    const target = mockTarget()
    const order: string[] = []
    const onDragStart = vi.fn(() => order.push('start'))
    const onDrag = vi.fn(() => order.push('drag'))
    const h = pointerDragHandlers({ isDisabled: () => false, onDragStart, onDrag })
    const e = pointerEvent({ currentTarget: target })
    h.onPointerDown(e)
    expect(target.setPointerCapture).toHaveBeenCalledWith(1)
    expect(onDragStart).toHaveBeenCalledWith(e)
    expect(onDrag).toHaveBeenCalledWith(e)
    expect(order).toEqual(['start', 'drag'])
  })

  it('pointerdown while disabled: ignored entirely', () => {
    const target = mockTarget()
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => true, onDrag })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    expect(onDrag).not.toHaveBeenCalled()
    // No drag started, so a later move must not call onDrag either.
    h.onPointerMove(pointerEvent({ currentTarget: target }))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('pointerdown with a non-primary button: ignored', () => {
    const target = mockTarget()
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    h.onPointerDown(pointerEvent({ button: 2, currentTarget: target }))
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('pointermove while dragging calls onDrag repeatedly', () => {
    const target = mockTarget()
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    onDrag.mockClear()
    h.onPointerMove(pointerEvent({ currentTarget: target, clientX: 10 }))
    h.onPointerMove(pointerEvent({ currentTarget: target, clientX: 20 }))
    expect(onDrag).toHaveBeenCalledTimes(2)
  })

  it('pointermove with no prior pointerdown does nothing', () => {
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    h.onPointerMove(pointerEvent({}))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('pointerup releases capture and ends the drag (a further move is inert)', () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    onDrag.mockClear()
    h.onPointerUp(pointerEvent({ currentTarget: target }))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
    h.onPointerMove(pointerEvent({ currentTarget: target }))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('pointercancel releases capture and ends the drag, same as pointerup', () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    h.onPointerCancel(pointerEvent({ currentTarget: target }))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
    onDrag.mockClear()
    h.onPointerMove(pointerEvent({ currentTarget: target }))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('pointerup without capture held does not call releasePointerCapture', () => {
    const target = mockTarget(false)
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn() })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    h.onPointerUp(pointerEvent({ currentTarget: target }))
    expect(target.releasePointerCapture).not.toHaveBeenCalled()
  })

  it('pointerup/pointercancel with no active drag are no-ops (no release call)', () => {
    const target = mockTarget(true)
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn() })
    h.onPointerUp(pointerEvent({ currentTarget: target }))
    h.onPointerCancel(pointerEvent({ currentTarget: target }))
    expect(target.releasePointerCapture).not.toHaveBeenCalled()
  })

  it('onDragStart is optional', () => {
    const target = mockTarget()
    const onDrag = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag })
    expect(() => h.onPointerDown(pointerEvent({ currentTarget: target }))).not.toThrow()
    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  it('onDragEnd fires once on pointerup, AFTER capture is released — added for gradient-picker', () => {
    const target = mockTarget(true)
    const order: string[] = []
    target.releasePointerCapture.mockImplementation(() => order.push('release'))
    const onDragEnd = vi.fn(() => order.push('end'))
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn(), onDragEnd })
    const e = pointerEvent({ currentTarget: target })
    h.onPointerDown(e)
    h.onPointerUp(e)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(e)
    expect(order).toEqual(['release', 'end'])
  })

  it('onDragEnd fires once on pointercancel, same as pointerup', () => {
    const target = mockTarget(true)
    const onDragEnd = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn(), onDragEnd })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    h.onPointerCancel(pointerEvent({ currentTarget: target }))
    expect(onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('onDragEnd is never called for a stray pointerup/pointercancel with no active drag', () => {
    const target = mockTarget(true)
    const onDragEnd = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn(), onDragEnd })
    h.onPointerUp(pointerEvent({ currentTarget: target }))
    h.onPointerCancel(pointerEvent({ currentTarget: target }))
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('onDragEnd is optional — pointerup/pointercancel still work without it', () => {
    const target = mockTarget(true)
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag: vi.fn() })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    expect(() => h.onPointerUp(pointerEvent({ currentTarget: target }))).not.toThrow()
  })

  // ── Finding G: robustness — lost capture, multi-pointer isolation ────────

  it('onLostPointerCapture ends an active drag even with no pointerup/pointercancel', () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const onDragEnd = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag, onDragEnd })
    h.onPointerDown(pointerEvent({ currentTarget: target }))
    onDrag.mockClear()
    h.onLostPointerCapture(pointerEvent({ currentTarget: target }))
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    // The flag is truly reset — a later move for the SAME pointer id is inert.
    h.onPointerMove(pointerEvent({ currentTarget: target }))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('onLostPointerCapture for an unrelated pointer id is ignored', () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const onDragEnd = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag, onDragEnd })
    h.onPointerDown(pointerEvent({ currentTarget: target, pointerId: 1 }))
    h.onLostPointerCapture(pointerEvent({ currentTarget: target, pointerId: 99 }))
    expect(onDragEnd).not.toHaveBeenCalled()
    // The original drag (pointerId 1) is still live.
    onDrag.mockClear()
    h.onPointerMove(pointerEvent({ currentTarget: target, pointerId: 1 }))
    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  it("a second pointer's pointermove/pointerup/pointercancel never affects the active drag", () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const onDragEnd = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag, onDragEnd })
    h.onPointerDown(pointerEvent({ currentTarget: target, pointerId: 1 }))
    onDrag.mockClear()
    h.onPointerMove(pointerEvent({ currentTarget: target, pointerId: 2 }))
    h.onPointerUp(pointerEvent({ currentTarget: target, pointerId: 2 }))
    h.onPointerCancel(pointerEvent({ currentTarget: target, pointerId: 2 }))
    expect(onDrag).not.toHaveBeenCalled()
    expect(onDragEnd).not.toHaveBeenCalled()
    // The real (pointerId 1) drag is unaffected.
    h.onPointerMove(pointerEvent({ currentTarget: target, pointerId: 1 }))
    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  it('a second pointerdown while a drag is already live is ignored (no hijack)', () => {
    const target = mockTarget(true)
    const onDrag = vi.fn()
    const onDragStart = vi.fn()
    const h = pointerDragHandlers({ isDisabled: () => false, onDrag, onDragStart })
    h.onPointerDown(pointerEvent({ currentTarget: target, pointerId: 1 }))
    onDrag.mockClear()
    onDragStart.mockClear()
    target.setPointerCapture.mockClear()
    h.onPointerDown(pointerEvent({ currentTarget: target, pointerId: 2 }))
    expect(onDragStart).not.toHaveBeenCalled()
    expect(onDrag).not.toHaveBeenCalled()
    expect(target.setPointerCapture).not.toHaveBeenCalled()
    // The original (pointerId 1) drag is still the active one.
    h.onPointerMove(pointerEvent({ currentTarget: target, pointerId: 1 }))
    expect(onDrag).toHaveBeenCalledTimes(1)
    h.onPointerMove(pointerEvent({ currentTarget: target, pointerId: 2 }))
    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  // ── Finding G: mounted, real events (no `as unknown as Event` casts) ─────
  //
  // jsdom implements real `PointerEvent` construction and real
  // `dispatchEvent`/`addEventListener`, but NOT `setPointerCapture`/
  // `hasPointerCapture`/`releasePointerCapture` — those three are stubbed
  // per-element below (documented, not hidden) because jsdom has no capture
  // model at all; everything else here is a genuine DOM element receiving a
  // genuine dispatched event, not a hand-built object cast to `PointerEvent`.
  describe('mounted: real elements, real dispatched PointerEvents', () => {
    function realTrackElement(): HTMLDivElement {
      const el = document.createElement('div')
      document.body.appendChild(el)
      Object.assign(el, {
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
      })
      return el
    }

    it('a real pointerdown -> pointermove -> pointerup sequence drives the handlers via addEventListener', () => {
      const el = realTrackElement()
      const positions: number[] = []
      const h = pointerDragHandlers({
        isDisabled: () => false,
        onDrag: (e) => positions.push(e.clientX),
      })
      el.addEventListener('pointerdown', h.onPointerDown)
      el.addEventListener('pointermove', h.onPointerMove)
      el.addEventListener('pointerup', h.onPointerUp)

      el.dispatchEvent(
        new PointerEvent('pointerdown', { pointerId: 5, button: 0, clientX: 1, bubbles: true }),
      )
      el.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 5, clientX: 42, bubbles: true }),
      )
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, bubbles: true }))

      expect(positions).toEqual([1, 42])
      expect(
        (el as unknown as { setPointerCapture: ReturnType<typeof vi.fn> }).setPointerCapture,
      ).toHaveBeenCalledWith(5)
      expect(
        (el as unknown as { releasePointerCapture: ReturnType<typeof vi.fn> })
          .releasePointerCapture,
      ).toHaveBeenCalledWith(5)

      // A pointermove dispatched AFTER pointerup is genuinely inert — proves
      // the handler, not just a mock, ended the drag.
      positions.length = 0
      el.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 5, clientX: 999, bubbles: true }),
      )
      expect(positions).toEqual([])
    })

    it('a real lostpointercapture event ends the drag through the actual DOM event name', () => {
      const el = realTrackElement()
      const onDragEnd = vi.fn()
      const onDrag = vi.fn()
      const h = pointerDragHandlers({ isDisabled: () => false, onDrag, onDragEnd })
      el.addEventListener('pointerdown', h.onPointerDown)
      el.addEventListener('lostpointercapture', h.onLostPointerCapture)
      el.addEventListener('pointermove', h.onPointerMove)

      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, bubbles: true }))
      el.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7, bubbles: true }))
      expect(onDragEnd).toHaveBeenCalledTimes(1)

      onDrag.mockClear()
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, bubbles: true }))
      expect(onDrag).not.toHaveBeenCalled()
    })
  })
})
