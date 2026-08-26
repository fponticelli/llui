import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/menubar'
import type { MenubarState } from '../../src/components/menubar'
import type { MenuItem } from '../../src/components/menu'
import { rootSignal, read } from '../_signal'

const fileItems: MenuItem[] = [
  { value: 'new', kind: 'action' },
  { value: 'open', kind: 'action' },
]
const editItems: MenuItem[] = [
  { value: 'cut', kind: 'action' },
  { value: 'copy', kind: 'action' },
]
const viewItems: MenuItem[] = [
  { value: 'zoom-in', kind: 'action' },
  { value: 'zoom-out', kind: 'action' },
]

const baseInit = () =>
  init({
    menus: [
      { id: 'file', items: fileItems },
      { id: 'edit', items: editItems },
      { id: 'view', items: viewItems },
    ],
  })

describe('menubar reducer', () => {
  it('initializes with menus, nothing open, first menu focused', () => {
    const s = baseInit()
    expect(s.menus).toEqual(['file', 'edit', 'view'])
    expect(s.open).toBeNull()
    expect(s.focused).toBe('file')
    expect(s.disabledMenus).toEqual([])
  })

  it('respects disabledMenus from init', () => {
    const s = init({
      menus: [
        { id: 'file', items: fileItems },
        { id: 'edit', items: editItems, disabled: true },
      ],
    })
    expect(s.disabledMenus).toEqual(['edit'])
  })

  it('openMenu opens the menu and focuses it', () => {
    const [s] = update(baseInit(), { type: 'openMenu', id: 'edit' })
    expect(s.open).toBe('edit')
    expect(s.focused).toBe('edit')
  })

  it('openMenu focuses the first item of the opened menu', () => {
    const [s] = update(baseInit(), { type: 'openMenu', id: 'file' })
    expect(s.menuStates['file']!.open).toBe(true)
    expect(s.menuStates['file']!.highlights['']).toBe('new')
  })

  it('openMenu is a no-op for a disabled menu', () => {
    const s0 = init({
      menus: [
        { id: 'file', items: fileItems },
        { id: 'edit', items: editItems, disabled: true },
      ],
    })
    const [s] = update(s0, { type: 'openMenu', id: 'edit' })
    expect(s.open).toBeNull()
  })

  it('closeMenu closes the open menu', () => {
    const [s1] = update(baseInit(), { type: 'openMenu', id: 'file' })
    const [s2] = update(s1, { type: 'closeMenu' })
    expect(s2.open).toBeNull()
    expect(s2.menuStates['file']!.open).toBe(false)
  })

  it('focusMenu moves focus without opening (closed mode)', () => {
    const [s] = update(baseInit(), { type: 'focusMenu', id: 'edit' })
    expect(s.focused).toBe('edit')
    expect(s.open).toBeNull()
  })

  it('focusMenu while a menu is open switches the open menu (open mode)', () => {
    const [s1] = update(baseInit(), { type: 'openMenu', id: 'file' })
    const [s2] = update(s1, { type: 'focusMenu', id: 'edit' })
    expect(s2.open).toBe('edit')
    expect(s2.focused).toBe('edit')
    expect(s2.menuStates['file']!.open).toBe(false)
    expect(s2.menuStates['edit']!.open).toBe(true)
  })

  it('focusNext moves focus right and wraps', () => {
    let s: MenubarState = baseInit()
    ;[s] = update(s, { type: 'focusNext' })
    expect(s.focused).toBe('edit')
    ;[s] = update(s, { type: 'focusNext' })
    expect(s.focused).toBe('view')
    ;[s] = update(s, { type: 'focusNext' })
    expect(s.focused).toBe('file')
  })

  it('focusPrev moves focus left and wraps', () => {
    let s: MenubarState = baseInit()
    ;[s] = update(s, { type: 'focusPrev' })
    expect(s.focused).toBe('view')
  })

  it('focusNext skips disabled menus', () => {
    const s0 = init({
      menus: [
        { id: 'file', items: fileItems },
        { id: 'edit', items: editItems, disabled: true },
        { id: 'view', items: viewItems },
      ],
    })
    const [s] = update(s0, { type: 'focusNext' })
    expect(s.focused).toBe('view')
  })

  it('focusNext while open switches the open menu (open mode)', () => {
    const [s1] = update(baseInit(), { type: 'openMenu', id: 'file' })
    const [s2] = update(s1, { type: 'focusNext' })
    expect(s2.open).toBe('edit')
    expect(s2.menuStates['edit']!.open).toBe(true)
    expect(s2.menuStates['file']!.open).toBe(false)
  })

  it('delegates a menu msg to the named menu machine', () => {
    const [s1] = update(baseInit(), { type: 'openMenu', id: 'file' })
    const [s2] = update(s1, {
      type: 'menuMsg',
      id: 'file',
      msg: { type: 'highlightNext', level: '' },
    })
    expect(s2.menuStates['file']!.highlights['']).toBe('open')
  })

  it('a menu msg that closes the menu (action select) clears top-level open', () => {
    const [s1] = update(baseInit(), { type: 'openMenu', id: 'file' })
    const [s2] = update(s1, {
      type: 'menuMsg',
      id: 'file',
      msg: { type: 'select', value: 'new' },
    })
    expect(s2.menuStates['file']!.open).toBe(false)
    expect(s2.open).toBeNull()
  })
})

describe('menubar.connect — root + triggers', () => {
  it('root has role menubar + aria-label', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'mb', label: 'Main' })
    expect(p.root.role).toBe('menubar')
    expect(p.root['aria-label']).toBe('Main')
  })

  it('menuTrigger has role menuitem + aria-haspopup menu', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'mb' })
    const t = p.menuTrigger('file')
    expect(t.role).toBe('menuitem')
    expect(t['aria-haspopup']).toBe('menu')
  })

  it('menuTrigger aria-expanded reflects whether its menu is open', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'mb' })
    const t = p.menuTrigger('file')
    expect(read(t['aria-expanded'], baseInit())).toBe(false)
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    expect(read(t['aria-expanded'], openState)).toBe(true)
  })

  it('roving tabindex: only the focused trigger is in the tab order', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'mb' })
    const file = p.menuTrigger('file')
    const edit = p.menuTrigger('edit')
    const s = baseInit() // focused = file
    expect(read(file.tabindex, s)).toBe(0)
    expect(read(edit.tabindex, s)).toBe(-1)
  })

  it('menuTrigger click opens its menu', () => {
    const send = vi.fn()
    const p = connect(signalFrom(baseInit()), send, { id: 'mb' })
    p.menuTrigger('file').onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'openMenu', id: 'file' })
  })

  it('menuTrigger click on an already-open menu closes it', () => {
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    p.menuTrigger('file').onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'closeMenu' })
  })

  it('focus on a trigger updates focus (closed mode)', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'mb' })
    p.menuTrigger('edit').onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'focusMenu', id: 'edit' })
  })
})

describe('menubar.connect — APG keyboard', () => {
  it('ArrowRight moves focus to the next trigger', () => {
    const send = vi.fn()
    const p = connect(signalFrom(baseInit()), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.menuTrigger('file').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext' })
  })

  it('ArrowLeft moves focus to the previous trigger', () => {
    const send = vi.fn()
    const p = connect(signalFrom(baseInit()), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.menuTrigger('file').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusPrev' })
  })

  it('ArrowDown opens the focused menu and focuses its first item', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })
    p.menuTrigger('file').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'openMenu', id: 'file' })
  })

  it('Enter opens the focused menu', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'mb' })
    p.menuTrigger('file').onKeyDown(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'openMenu', id: 'file' })
  })

  it('Space opens the focused menu', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'mb' })
    p.menuTrigger('file').onKeyDown(new KeyboardEvent('keydown', { key: ' ', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'openMenu', id: 'file' })
  })

  it('open mode: pointer entering a sibling trigger switches the open menu', () => {
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    p.menuTrigger('edit').onPointerEnter({} as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'focusMenu', id: 'edit' })
  })

  it('closed mode: pointer entering a trigger does NOT open it', () => {
    const send = vi.fn()
    const p = connect(signalFrom(baseInit()), send, { id: 'mb' }) // nothing open
    p.menuTrigger('edit').onPointerEnter({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
  })

  it('the delegated bag names the SAME trigger id the bar renders', () => {
    // `menubar.overlay` anchors on `parts.trigger.id` of the DELEGATED menu bag,
    // while the consumer renders `menuTrigger(id)`. If the two strings drift the
    // overlay anchors on an element nothing renders: no positioning, no
    // dismiss-ignore, no focus restore (#121).
    const p = connect(rootSignal(), vi.fn(), { id: 'mb' })
    expect(p.menu('file').trigger.id).toBe(p.menuTrigger('file').id)
    // …and the trigger's aria-controls names the delegated content it opens.
    expect(p.menuTrigger('file')['aria-controls']).toBe(p.menu('file').content.id)
  })

  it('per-menu content/item parts are delegated to the menu machine', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'mb' })
    const menuParts = p.menu('file')
    expect(menuParts.content.role).toBe('menu')
    expect(menuParts.item('new').item.role).toBe('menuitem')
  })

  it('delegated content Escape closes the menu and the menubar restores focus to the trigger', () => {
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    p.menu('file').content.onKeyDown(ev)
    // delegated to the menu machine's content keynav => close
    expect(send).toHaveBeenCalledWith({ type: 'menuMsg', id: 'file', msg: { type: 'close' } })
  })

  // APG: with a menu open, focus lives on the CONTENT, so Left/Right land there
  // and never reach the trigger's handler. The panel's own handler `preventDefault`s
  // exactly when it consumes an arrow (opening a submenu, closing one), so an
  // arrow that survives it is one the menubar owns — that is the fall-through
  // this pins. Without it a keyboard user who opened File could not reach Edit
  // without closing the menu first, and the two directions were silent.
  it('delegated content ArrowRight walks to the next menu when the panel did not use it', () => {
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.menu('file').content.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext' })
  })

  it('delegated content ArrowLeft walks to the previous menu', () => {
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'edit' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.menu('edit').content.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusPrev' })
  })

  it('does NOT walk when the panel consumed the arrow (submenu open/close)', () => {
    // ArrowLeft with a submenu open is the panel's — it steps back one level.
    // Reading `defaultPrevented` is what separates the two cases, so a menubar
    // that walked unconditionally would swallow every submenu escape.
    const send = vi.fn()
    const withSub = init({
      menus: [
        {
          id: 'file',
          items: [
            { value: 'new', kind: 'action' },
            { value: 'recent', kind: 'action', children: [{ value: 'r1', kind: 'action' }] },
          ],
        },
        { id: 'edit', items: editItems },
      ],
    })
    let s = update(withSub, { type: 'openMenu', id: 'file' })[0]
    s = update(s, { type: 'menuMsg', id: 'file', msg: { type: 'openSub', value: 'recent' } })[0]
    const p = connect(signalFrom(s), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true })
    p.menu('file').content.onKeyDown(ev)
    expect(send).toHaveBeenCalledWith({
      type: 'menuMsg',
      id: 'file',
      msg: { type: 'closeSub' },
    })
    expect(send).not.toHaveBeenCalledWith({ type: 'focusPrev' })
  })

  it('leaves a key the panel did NOT consume alone', () => {
    // Tab, deliberately: it is the one key here the panel neither consumes nor
    // wants. `ArrowDown` would NOT test this — the panel `preventDefault`s it,
    // so the `defaultPrevented` guard returns first and the key filter is never
    // reached. Measured: with `ArrowDown` here, deleting the key filter
    // entirely left the suite GREEN, and every Tab out of an open menu then
    // walked the bar instead.
    const send = vi.fn()
    const openState = update(baseInit(), { type: 'openMenu', id: 'file' })[0]
    const p = connect(signalFrom(openState), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    p.menu('file').content.onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(send).not.toHaveBeenCalledWith({ type: 'focusNext' })
    expect(send).not.toHaveBeenCalledWith({ type: 'focusPrev' })
  })
})

// helper: a Signal backed by a concrete state value for handler-time peeks.
import { signalOf } from '../_signal'
function signalFrom(state: MenubarState) {
  return signalOf(state)
}
