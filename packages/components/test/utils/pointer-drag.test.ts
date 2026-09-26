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
})
