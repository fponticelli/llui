import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, update, connect, isOpen } from '../../src/components/navigation-menu'
import type { NavMenuState } from '../../src/components/navigation-menu'
import { rootSignal, signalOf, read } from '../_signal'

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
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const branch = p.item('file', { isBranch: true }).trigger
    expect(read(branch['aria-expanded'], init())).toBe(false)
    expect(read(branch['aria-expanded'], init({ open: ['file'] }))).toBe(true)
    // Leaf items have no aria-expanded
    const leaf = p.item('home', { isBranch: false }).trigger
    expect(read(leaf['aria-expanded'], init())).toBeUndefined()
  })

  // Finding 15: disclosure semantics, not application-menu roles. Branch
  // triggers are disclosure buttons (aria-controls); no menuitem/haspopup roles.
  it('trigger uses aria-controls for branches; no application-menu roles', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const branch = p.item('file', { isBranch: true }).trigger
    const leaf = p.item('home', { isBranch: false }).trigger
    expect(branch['aria-controls']).toBe('nav:content:file')
    expect(leaf['aria-controls']).toBeUndefined()
    expect('aria-haspopup' in branch).toBe(false)
    expect('role' in branch).toBe(false)
    expect('role' in p.item('file', { isBranch: true }).content).toBe(false)
  })

  it('root is a nav landmark, not a menubar', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    expect('role' in p.root).toBe(false)
    expect(p.root['aria-label']).toBeDefined()
  })

  it('pointerEnter opens branch', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav' })
    p.item('file', { isBranch: true }).trigger.onPointerEnter({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'openBranch', id: 'file', ancestorIds: [] })
  })

  it('pointerEnter on leaf is a no-op', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav' })
    p.item('home', { isBranch: false }).trigger.onPointerEnter({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
  })

  it('click on branch toggles it; click on leaf is a no-op', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav' })
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

  it('root pointerLeave dispatches closeAll after delay when closeOnLeave=true', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav' })
    p.root.onPointerLeave({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(150)
    expect(send).toHaveBeenCalledWith({ type: 'closeAll' })
    vi.useRealTimers()
  })

  it('pointerEnter on root cancels pending close', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav' })
    p.root.onPointerLeave({} as PointerEvent)
    p.root.onPointerEnter({} as PointerEvent)
    vi.advanceTimersByTime(200)
    expect(send).not.toHaveBeenCalledWith({ type: 'closeAll' })
    vi.useRealTimers()
  })

  it('closeOnLeave:false prevents auto-close', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'nav', closeOnLeave: false })
    p.root.onPointerLeave({} as PointerEvent)
    vi.advanceTimersByTime(200)
    expect(send).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('content hidden when not open', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const content = p.item('file', { isBranch: true }).content
    expect(read(content.hidden, init())).toBe(true)
    expect(read(content.hidden, init({ open: ['file'] }))).toBe(false)
  })
})

describe('navigation-menu close timer resolves its OWN instance (#123)', () => {
  // Two navs in one document. The guard used to `document.querySelector` the
  // FIRST `[data-part="trigger"]` in document order, so the second instance
  // checked the FIRST one's liveness and dispatched into a disposed handle.
  function makeNav(id: string): HTMLElement {
    const root = document.createElement('nav')
    root.setAttribute('data-scope', 'navigation-menu')
    root.setAttribute('data-part', 'root')
    const trigger = document.createElement('button')
    trigger.id = `${id}:trigger:home`
    trigger.setAttribute('data-scope', 'navigation-menu')
    trigger.setAttribute('data-part', 'trigger')
    root.append(trigger)
    return root
  }

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('drops the close when its own root has detached, even if a sibling nav is live', () => {
    const navA = makeNav('a')
    const navB = makeNav('b')
    document.body.append(navA, navB)

    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'b' })
    // Dispatch a real event so `currentTarget` is navB, as it is in the browser.
    navB.addEventListener('pointerleave', (e) => p.root.onPointerLeave(e as PointerEvent))
    navB.dispatchEvent(new Event('pointerleave'))

    // navB unmounts while the timer is pending; navA stays in the document.
    navB.remove()
    expect(navA.isConnected).toBe(true)
    vi.advanceTimersByTime(200)
    expect(send).not.toHaveBeenCalled()
  })

  it('still closes while its own root is live (the guard is not vacuous)', () => {
    const navA = makeNav('a')
    const navB = makeNav('b')
    document.body.append(navA, navB)

    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'b' })
    navB.addEventListener('pointerleave', (e) => p.root.onPointerLeave(e as PointerEvent))
    navB.dispatchEvent(new Event('pointerleave'))
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledWith({ type: 'closeAll' })
  })
})

describe('navigation-menu RTL', () => {
  it('init defaults dir to ltr; respects opts.dir', () => {
    expect(init().dir).toBe('ltr')
    expect(init({ dir: 'rtl' }).dir).toBe('rtl')
  })

  it('setDir updates the reading direction (even when disabled)', () => {
    const [s] = update(init({ disabled: true }), { type: 'setDir', dir: 'rtl' })
    expect(s.dir).toBe('rtl')
  })

  it('ltr: ArrowRight opens a branch, ArrowLeft closes it', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send, { id: 'nav' })
    const trigger = p.item('file', { isBranch: true }).trigger
    trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'openBranch', id: 'file', ancestorIds: [] })
    send.mockClear()
    trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'closeBranch', id: 'file' })
  })

  it('rtl: horizontal arrows swap — ArrowLeft opens, ArrowRight closes', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send, { id: 'nav' })
    const trigger = p.item('file', { isBranch: true, ancestorIds: ['root'] }).trigger
    trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(send).toHaveBeenCalledWith({ type: 'openBranch', id: 'file', ancestorIds: ['root'] })
    send.mockClear()
    trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(send).toHaveBeenCalledWith({ type: 'closeBranch', id: 'file' })
  })

  it('ArrowDown opens a branch and is never flipped under rtl', () => {
    const send = vi.fn()
    const p = connect(signalOf(init({ dir: 'rtl' })), send, { id: 'nav' })
    const trigger = p.item('file', { isBranch: true }).trigger
    trigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(send).toHaveBeenCalledWith({ type: 'openBranch', id: 'file', ancestorIds: [] })
  })

  it('arrow keydown on a leaf is a no-op', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send, { id: 'nav' })
    p.item('home', { isBranch: false }).trigger.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    )
    expect(send).not.toHaveBeenCalled()
  })
})

describe('navigation-menu.connect — tab sequence (WCAG 2.1.1)', () => {
  it('the default state has exactly one tab stop', () => {
    // `focused` starts null and only a trigger's own onFocus ever sets it, so
    // without a fallback EVERY trigger reads -1 and the whole nav is
    // unreachable by Tab (#122).
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const ids = ['home', 'products', 'about']
    const triggers = ids.map((id) => p.item(id, { isBranch: id !== 'home' }).trigger)
    const s = init()
    const stops = triggers.filter((t) => read(t.tabindex, s) === 0)
    expect(stops).toHaveLength(1)
    // …and it is the FIRST item handed to `item()`, i.e. document order.
    expect(read(triggers[0]!.tabindex, s)).toBe(0)
  })

  it('a dynamic list keeps its tab stop when the first item is removed', () => {
    // With items rendered through `each`, `item()` is called per ROW, so the
    // connect-time latch pins whichever id happened to build first — forever.
    // Remove that row and the latched id no longer exists: every remaining
    // trigger reads -1 and the nav loses its tab stop entirely, re-opening the
    // WCAG 2.1.1 defect this component just closed. `items` in state is the
    // current order (the same escape hatch radio-group/tabs use) and wins over
    // the latch.
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const home = p.item('home', { isBranch: false }).trigger
    const products = p.item('products', { isBranch: true }).trigger
    const about = p.item('about', { isBranch: false }).trigger

    const all = init({ items: ['home', 'products', 'about'] })
    expect(read(home.tabindex, all)).toBe(0)

    // 'home' has been removed from the rendered list.
    const without = init({ items: ['products', 'about'] })
    const triggers = [home, products, about]
    expect(triggers.filter((t) => read(t.tabindex, without) === 0)).toHaveLength(1)
    expect(read(products.tabindex, without)).toBe(0)
  })

  it('setItems re-seats the tab stop while nothing is focused', () => {
    const [s] = update(init({ items: ['a', 'b'] }), { type: 'setItems', items: ['b', 'c'] })
    expect(s.items).toEqual(['b', 'c'])
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const b = p.item('b', { isBranch: false }).trigger
    expect(read(b.tabindex, s)).toBe(0)
  })

  it('once an item is focused it owns the tab stop', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'nav' })
    const first = p.item('home', { isBranch: false }).trigger
    const second = p.item('products', { isBranch: true }).trigger
    const s = init({ focused: 'products' })
    expect(read(first.tabindex, s)).toBe(-1)
    expect(read(second.tabindex, s)).toBe(0)
  })
})
