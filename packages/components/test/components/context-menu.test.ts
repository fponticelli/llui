import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/context-menu'
import type { ContextMenuState } from '../../src/components/context-menu'

type Ctx = { m: ContextMenuState }
const wrap = (m: ContextMenuState): Ctx => ({ m })

describe('context-menu reducer', () => {
  it('initializes closed at 0,0', () => {
    expect(init()).toMatchObject({ open: false, x: 0, y: 0 })
  })

  it('openAt sets position and open, highlights first item', () => {
    const s0 = init({ items: ['a', 'b'] })
    const [s] = update(s0, { type: 'openAt', x: 100, y: 200 })
    expect(s.open).toBe(true)
    expect(s.x).toBe(100)
    expect(s.y).toBe(200)
    expect(s.highlighted).toBe('a')
  })

  it('close clears open + highlighted', () => {
    const s0 = { ...init({ items: ['a'] }), open: true, highlighted: 'a' }
    const [s] = update(s0, { type: 'close' })
    expect(s.open).toBe(false)
    expect(s.highlighted).toBeNull()
  })

  it('highlightNext wraps', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), highlighted: 'b' }
    const [s] = update(s0, { type: 'highlightNext' })
    expect(s.highlighted).toBe('a')
  })

  it('select closes menu', () => {
    const s0 = { ...init({ items: ['a', 'b'] }), open: true, highlighted: 'a' }
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(false)
  })

  it('select ignored for disabled', () => {
    const s0 = { ...init({ items: ['a'], disabledItems: ['a'] }), open: true }
    const [s] = update(s0, { type: 'select', value: 'a' })
    expect(s.open).toBe(true)
  })
})

describe('context-menu.connect', () => {
  const p = connect<Ctx>((s) => s.m, vi.fn(), { id: 'cm1' })

  it('trigger contextmenu sends openAt with coordinates', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.m, send, { id: 'x' })
    const ev = new MouseEvent('contextmenu', { clientX: 150, clientY: 75, cancelable: true })
    pc.trigger.onContextMenu(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openAt', x: 150, y: 75 })
  })

  it('positioner style uses x/y', () => {
    const style = p.positioner.style(
      wrap({ ...init({ items: ['a'] }), open: true, x: 42, y: 99 }),
    )
    expect(style).toContain('top:99px')
    expect(style).toContain('left:42px')
  })

  it('content ArrowDown sends highlightNext', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.m, send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'highlightNext' })
  })

  it('content Escape closes', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.m, send, { id: 'x' })
    pc.content.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('item click sends select + invokes onSelect', () => {
    const send = vi.fn()
    const onSelect = vi.fn()
    const pc = connect<Ctx>((s) => s.m, send, { id: 'x', onSelect })
    pc.item('a').item.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'select', value: 'a' })
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
