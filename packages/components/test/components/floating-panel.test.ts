import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/floating-panel'
import type { FloatingPanelState } from '../../src/components/floating-panel'
import { rootSignal, read } from '../_signal'

describe('floating-panel reducer', () => {
  it('initializes open at (100, 100) with 400×300', () => {
    expect(init()).toMatchObject({
      position: { x: 100, y: 100 },
      size: { width: 400, height: 300 },
      open: true,
      minimized: false,
      maximized: false,
    })
  })

  it('close stops dragging + resizing', () => {
    const s0: FloatingPanelState = { ...init(), dragging: true, resizing: 'e' }
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.dragging).toBe(false)
    expect(s.resizing).toBeNull()
  })

  it('dragMove adds deltas to position', () => {
    const s0 = { ...init(), dragging: true } as FloatingPanelState
    const [s] = update(s0, { type: 'dragMove', dx: 10, dy: 20 })
    expect(s.position).toEqual({ x: 110, y: 120 })
  })

  it('dragMove is a no-op when not dragging', () => {
    const [s] = update(init(), { type: 'dragMove', dx: 50, dy: 50 })
    expect(s.position).toEqual({ x: 100, y: 100 })
  })

  it('resize east grows width', () => {
    const s0 = { ...init(), resizing: 'e' as const } as FloatingPanelState
    const [s] = update(s0, { type: 'resizeMove', dx: 50, dy: 0 })
    expect(s.size.width).toBe(450)
    expect(s.position.x).toBe(100) // unchanged
  })

  it('resize west moves x + shrinks width', () => {
    const s0 = { ...init(), resizing: 'w' as const } as FloatingPanelState
    const [s] = update(s0, { type: 'resizeMove', dx: 50, dy: 0 })
    expect(s.size.width).toBe(350)
    expect(s.position.x).toBe(150)
  })

  it('resize respects minSize', () => {
    const s0 = { ...init({ minSize: { width: 200, height: 150 } }), resizing: 'e' as const }
    const [s] = update(s0, { type: 'resizeMove', dx: -500, dy: 0 })
    expect(s.size.width).toBe(200)
  })

  it('maximize snapshots restoreBounds', () => {
    const s0 = init()
    const [s] = update(s0, { type: 'maximize' })
    expect(s.maximized).toBe(true)
    expect(s.restoreBounds).toEqual({ x: 100, y: 100, width: 400, height: 300 })
  })

  it('restoreFromMaximized restores geometry', () => {
    const s0 = init()
    const [s1] = update(s0, { type: 'maximize' })
    const [s2] = update(s1, { type: 'restoreFromMaximized' })
    expect(s2.maximized).toBe(false)
    expect(s2.position).toEqual({ x: 100, y: 100 })
    expect(s2.size).toEqual({ width: 400, height: 300 })
  })

  it('dragStart blocked when maximized', () => {
    const s0 = { ...init(), maximized: true } as FloatingPanelState
    const [s] = update(s0, { type: 'dragStart' })
    expect(s.dragging).toBe(false)
  })

  it('toggleMinimize flips state', () => {
    const [s1] = update(init(), { type: 'toggleMinimize' })
    expect(s1.minimized).toBe(true)
    const [s2] = update(s1, { type: 'toggleMinimize' })
    expect(s2.minimized).toBe(false)
  })
})

describe('floating-panel.connect', () => {
  it('root style reflects position + size', () => {
    const p = connect(rootSignal(), vi.fn())
    const style = read(p.root.style, init())
    expect(style).toContain('left:100px')
    expect(style).toContain('width:400px')
  })

  it('root style switches to inset:0 when maximized', () => {
    const p = connect(rootSignal(), vi.fn())
    const maxed = { ...init(), maximized: true } as FloatingPanelState
    const style = read(p.root.style, maxed)
    expect(style).toContain('inset:0')
  })

  it('content hidden when minimized', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.content.hidden, init())).toBe(false)
    const min = { ...init(), minimized: true } as FloatingPanelState
    expect(read(p.content.hidden, min)).toBe(true)
  })

  it('dragHandle onPointerDown dispatches dragStart', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.dragHandle.onPointerDown({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'dragStart' })
  })

  it('resizeHandle dispatches resizeStart with handle', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    p.resizeHandle('se').onPointerDown({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'resizeStart', handle: 'se' })
  })

  it('minimize/maximize triggers publish their toggle state (#266)', () => {
    const p = connect(rootSignal(), vi.fn())
    expect(read(p.minimizeTrigger['aria-pressed'], init())).toBe('false')
    expect(read(p.minimizeTrigger['aria-pressed'], { ...init(), minimized: true })).toBe('true')
    expect(read(p.maximizeTrigger['aria-pressed'], { ...init(), maximized: true })).toBe('true')
  })
})

// #266: the panel could only be moved and resized with a pointer. The drag
// handle and every resize grip are now keyboard stops with the same geometry
// rules the pointer path uses (minSize/maxSize clamp, maximized blocks both).
describe('floating-panel keyboard parity (#266)', () => {
  it('moveBy moves without a drag in progress; maximized refuses it', () => {
    const [s] = update(init(), { type: 'moveBy', dx: 10, dy: -20 })
    expect(s.position).toEqual({ x: 110, y: 80 })
    const max = update(init(), { type: 'maximize' })[0]
    expect(update(max, { type: 'moveBy', dx: 10, dy: 0 })[0]).toBe(max)
    expect(update(init(), { type: 'moveBy', dx: Number.NaN, dy: 0 })[0].position).toEqual({
      x: 100,
      y: 100,
    })
  })

  it('resizeBy applies the pointer resize math for the named handle, clamped', () => {
    const s0 = init({ minSize: { width: 200, height: 150 }, maxSize: { width: 450 } })
    expect(update(s0, { type: 'resizeBy', handle: 'se', dx: 10, dy: 10 })[0].size).toEqual({
      width: 410,
      height: 310,
    })
    // West edge: x moves with the edge, width shrinks.
    const west = update(s0, { type: 'resizeBy', handle: 'w', dx: 10, dy: 0 })[0]
    expect(west.position.x).toBe(110)
    expect(west.size.width).toBe(390)
    // Constraints: max width 450, min height 150.
    expect(update(s0, { type: 'resizeBy', handle: 'e', dx: 500, dy: 0 })[0].size.width).toBe(450)
    expect(update(s0, { type: 'resizeBy', handle: 's', dx: 0, dy: -500 })[0].size.height).toBe(150)
    const max = update(s0, { type: 'maximize' })[0]
    expect(update(max, { type: 'resizeBy', handle: 'se', dx: 5, dy: 5 })[0]).toBe(max)
  })

  const key = (handler: (e: KeyboardEvent) => void, init: KeyboardEventInit): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { cancelable: true, ...init })
    handler(e)
    return e
  }

  it('the drag handle is a named keyboard stop whose arrows move the panel', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    expect(p.dragHandle.tabindex).toBe(0)
    expect(p.dragHandle['aria-label']).toBe('Move panel')
    expect(key(p.dragHandle.onKeyDown, { key: 'ArrowLeft' }).defaultPrevented).toBe(true)
    expect(send).toHaveBeenLastCalledWith({ type: 'moveBy', dx: -10, dy: 0 })
    key(p.dragHandle.onKeyDown, { key: 'ArrowDown', shiftKey: true })
    expect(send).toHaveBeenLastCalledWith({ type: 'moveBy', dx: 0, dy: 50 })
    send.mockClear()
    expect(key(p.dragHandle.onKeyDown, { key: 'Enter' }).defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('a resize grip is a named keyboard stop whose arrows resize from that grip', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send)
    const se = p.resizeHandle('se')
    expect(se.tabindex).toBe(0)
    expect(se['aria-label']).toBe('Resize panel')
    key(se.onKeyDown, { key: 'ArrowRight' })
    expect(send).toHaveBeenLastCalledWith({ type: 'resizeBy', handle: 'se', dx: 10, dy: 0 })
    key(se.onKeyDown, { key: 'ArrowUp', shiftKey: true })
    expect(send).toHaveBeenLastCalledWith({ type: 'resizeBy', handle: 'se', dx: 0, dy: -50 })
  })
})
