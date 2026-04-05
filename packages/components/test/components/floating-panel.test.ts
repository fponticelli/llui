import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/floating-panel'
import type { FloatingPanelState } from '../../src/components/floating-panel'

type Ctx = { p: FloatingPanelState }
const wrap = (p: FloatingPanelState): Ctx => ({ p })

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
    const p = connect<Ctx>((s) => s.p, vi.fn())
    const style = p.root.style(wrap(init()))
    expect(style).toContain('left:100px')
    expect(style).toContain('width:400px')
  })

  it('root style switches to inset:0 when maximized', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    const maxed = { ...init(), maximized: true } as FloatingPanelState
    const style = p.root.style(wrap(maxed))
    expect(style).toContain('inset:0')
  })

  it('content hidden when minimized', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.content.hidden(wrap(init()))).toBe(false)
    const min = { ...init(), minimized: true } as FloatingPanelState
    expect(p.content.hidden(wrap(min))).toBe(true)
  })

  it('dragHandle onPointerDown dispatches dragStart', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.dragHandle.onPointerDown({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'dragStart' })
  })

  it('resizeHandle dispatches resizeStart with handle', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.resizeHandle('se').onPointerDown({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'resizeStart', handle: 'se' })
  })
})
