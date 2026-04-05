import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isOpen } from '../../src/components/navigation-menu'
import type { NavMenuState } from '../../src/components/navigation-menu'

type Ctx = { n: NavMenuState }
const wrap = (n: NavMenuState): Ctx => ({ n })

describe('navigation-menu reducer', () => {
  it('starts with nothing open', () => {
    expect(init()).toMatchObject({ open: [], focused: null })
  })

  it('openBranch with no ancestors opens a root branch', () => {
    const [s] = update(init(), { type: 'openBranch', id: 'file', ancestorIds: [] })
    expect(s.open).toEqual(['file'])
  })

  it('openBranch closes sibling root branches', () => {
    let s: NavMenuState = init()
    ;[s] = update(s, { type: 'openBranch', id: 'file', ancestorIds: [] })
    ;[s] = update(s, { type: 'openBranch', id: 'edit', ancestorIds: [] })
    expect(s.open).toEqual(['edit'])
  })

  it('openBranch preserves ancestor chain', () => {
    let s: NavMenuState = init()
    ;[s] = update(s, { type: 'openBranch', id: 'file', ancestorIds: [] })
    ;[s] = update(s, { type: 'openBranch', id: 'recent', ancestorIds: ['file'] })
    expect(s.open).toEqual(['file', 'recent'])
  })

  it('opening a sibling at a nested level closes only that sibling', () => {
    let s: NavMenuState = init()
    ;[s] = update(s, { type: 'openBranch', id: 'file', ancestorIds: [] })
    ;[s] = update(s, { type: 'openBranch', id: 'recent', ancestorIds: ['file'] })
    ;[s] = update(s, { type: 'openBranch', id: 'export', ancestorIds: ['file'] })
    expect(s.open).toEqual(['file', 'export'])
  })

  it('closeBranch closes the branch + all descendants', () => {
    let s: NavMenuState = init()
    ;[s] = update(s, { type: 'openBranch', id: 'file', ancestorIds: [] })
    ;[s] = update(s, { type: 'openBranch', id: 'recent', ancestorIds: ['file'] })
    ;[s] = update(s, { type: 'closeBranch', id: 'file' })
    expect(s.open).toEqual([])
  })

  it('closeBranch no-op for non-open branch', () => {
    const s0 = init()
    const [s] = update(s0, { type: 'closeBranch', id: 'file' })
    expect(s).toBe(s0)
  })

  it('toggleBranch opens then closes', () => {
    let s: NavMenuState = init()
    ;[s] = update(s, { type: 'toggleBranch', id: 'file', ancestorIds: [] })
    expect(s.open).toEqual(['file'])
    ;[s] = update(s, { type: 'toggleBranch', id: 'file', ancestorIds: [] })
    expect(s.open).toEqual([])
  })

  it('closeAll empties open', () => {
    const s0 = init({ open: ['a', 'b', 'c'] })
    const [s] = update(s0, { type: 'closeAll' })
    expect(s.open).toEqual([])
  })

  it('focus updates focused', () => {
    const [s] = update(init(), { type: 'focus', id: 'file' })
    expect(s.focused).toBe('file')
  })

  it('disabled blocks all mutations', () => {
    const s0 = init({ disabled: true })
    const [s] = update(s0, { type: 'openBranch', id: 'file', ancestorIds: [] })
    expect(s.open).toEqual([])
  })
})

describe('isOpen helper', () => {
  it('checks membership', () => {
    const s = init({ open: ['file'] })
    expect(isOpen(s, 'file')).toBe(true)
    expect(isOpen(s, 'edit')).toBe(false)
  })
})

describe('navigation-menu.connect', () => {
  it('trigger aria-expanded reflects open state (branch only)', () => {
    const p = connect<Ctx>((s) => s.n, vi.fn(), { id: 'nav' })
    const branch = p.item('file', { isBranch: true }).trigger
    expect(branch['aria-expanded'](wrap(init()))).toBe(false)
    expect(branch['aria-expanded'](wrap(init({ open: ['file'] })))).toBe(true)
    // Leaf items have no aria-expanded
    const leaf = p.item('home', { isBranch: false }).trigger
    expect(leaf['aria-expanded'](wrap(init()))).toBeUndefined()
  })

  it('trigger aria-haspopup set only for branches', () => {
    const p = connect<Ctx>((s) => s.n, vi.fn(), { id: 'nav' })
    expect(p.item('file', { isBranch: true }).trigger['aria-haspopup']).toBe('menu')
    expect(p.item('home', { isBranch: false }).trigger['aria-haspopup']).toBeUndefined()
  })

  it('pointerEnter opens branch', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.n, send, { id: 'nav' })
    p.item('file', { isBranch: true }).trigger.onPointerEnter({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'openBranch', id: 'file', ancestorIds: [] })
  })

  it('pointerEnter on leaf is a no-op', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.n, send, { id: 'nav' })
    p.item('home', { isBranch: false }).trigger.onPointerEnter({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
  })

  it('click on branch toggles it; click on leaf is a no-op', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.n, send, { id: 'nav' })
    p.item('file', { isBranch: true, ancestorIds: ['root'] }).trigger.onClick(
      new MouseEvent('click'),
    )
    expect(send).toHaveBeenCalledWith({
      type: 'toggleBranch',
      id: 'file',
      ancestorIds: ['root'],
    })
    send.mockClear()
    p.item('home', { isBranch: false }).trigger.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('root pointerLeave dispatches closeAll when closeOnLeave=true', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.n, send, { id: 'nav' })
    p.root.onPointerLeave({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'closeAll' })
  })

  it('closeOnLeave:false prevents auto-close', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.n, send, { id: 'nav', closeOnLeave: false })
    p.root.onPointerLeave({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
  })

  it('content hidden when not open', () => {
    const p = connect<Ctx>((s) => s.n, vi.fn(), { id: 'nav' })
    const content = p.item('file', { isBranch: true }).content
    expect(content.hidden(wrap(init()))).toBe(true)
    expect(content.hidden(wrap(init({ open: ['file'] })))).toBe(false)
  })
})
