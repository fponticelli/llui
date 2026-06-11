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
    const p = connect(rootSignal(), send, { id: 'mb' })
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
    const p = connect(rootSignal(), send, { id: 'mb' })
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })
    p.menuTrigger('file').onKeyDown(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith({ type: 'focusNext' })
  })

  it('ArrowLeft moves focus to the previous trigger', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'mb' })
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
    const p = connect(rootSignal(), send, { id: 'mb' }) // nothing open
    p.menuTrigger('edit').onPointerEnter({} as PointerEvent)
    expect(send).not.toHaveBeenCalled()
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
})

// helper: a Signal backed by a concrete state value for handler-time peeks.
import { signalOf } from '../_signal'
function signalFrom(state: MenubarState) {
  return signalOf(state)
}
