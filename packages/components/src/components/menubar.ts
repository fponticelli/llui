import type { Send, Signal, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable.js'
import { attachFloating, type Placement } from '../utils/floating.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { getElementByIdInScope } from '../utils/root-scope.js'
import { focusRovingItem } from '../utils/roving.js'
import {
  init as menuInit,
  update as menuUpdate,
  connect as menuConnect,
  type MenuState,
  type MenuMsg,
  type MenuItem,
  type MenuParts,
} from './menu.js'

/**
 * Menubar — a desktop-style application menu bar (File / Edit / View …).
 *
 * Composes N `menu` machines: each top-level trigger owns a child `menu`
 * state (submenus, checkbox/radio items, groups, typeahead — all delegated to
 * the menu reducer/connect). The menubar coordinates which menu is open,
 * which top-level trigger has roving focus, and the WAI-ARIA APG menubar
 * keyboard model:
 *
 *   - ArrowLeft / ArrowRight move between top-level triggers (roving tabindex
 *     = a single tab stop).
 *   - Once any menu is open the menubar is in "open mode": moving focus (arrow
 *     or hover) to a sibling trigger switches the open menu.
 *   - ArrowDown / Enter / Space open the focused menu and focus its first item.
 *   - Escape closes the menu and returns focus to its trigger; nested submenus
 *     unwind one level at a time through the shared dismissable stack
 *     (delegated to the menu machine).
 *
 * State is JSON-serializable: top-level coordination plus a `Record` of the
 * embedded per-menu `MenuState`s keyed by menu id.
 */

/** Declarative description of one top-level menu in the bar. */
export interface MenubarMenu {
  id: string
  items: MenuItem[]
  disabled?: boolean
  /** When true, selecting a checkbox/radio also closes this menu. */
  closeOnSelect?: boolean
}

export interface MenubarState {
  /** Top-level menu ids, in bar order. */
  menus: string[]
  /** The id of the currently-open menu, or null. */
  open: string | null
  /** The id of the top-level trigger that holds roving focus. */
  focused: string | null
  /** Ids of disabled menus (cannot be opened/focused). */
  disabledMenus: string[]
  /** Embedded per-menu machine states, keyed by menu id. */
  menuStates: Record<string, MenuState>
}

export type MenubarMsg =
  /** @intent("Open the menu with the given id and focus its first item") */
  | { type: 'openMenu'; id: string }
  /** @intent("Close the currently-open menu") */
  | { type: 'closeMenu' }
  /** @intent("Move roving focus to the menu with the given id (switches the open menu in open mode)") */
  | { type: 'focusMenu'; id: string }
  /** @humanOnly */
  | { type: 'focusNext' }
  /** @humanOnly */
  | { type: 'focusPrev' }
  /** @humanOnly */
  | { type: 'menuMsg'; id: string; msg: MenuMsg }

export interface MenubarInit {
  menus: MenubarMenu[]
  /** Initially-focused menu id (defaults to the first enabled menu). */
  focused?: string | null
}

export function init(opts: MenubarInit): MenubarState {
  const menus = opts.menus.map((m) => m.id)
  const disabledMenus = opts.menus.filter((m) => m.disabled).map((m) => m.id)
  const menuStates: Record<string, MenuState> = {}
  for (const m of opts.menus) {
    menuStates[m.id] = menuInit({ items: m.items, closeOnSelect: m.closeOnSelect })
  }
  const focused = opts.focused !== undefined ? opts.focused : firstEnabled(menus, disabledMenus)
  return { menus, open: null, focused, disabledMenus, menuStates }
}

// ---- pure helpers ----

function firstEnabled(menus: string[], disabled: string[]): string | null {
  for (const id of menus) if (!disabled.includes(id)) return id
  return null
}

function navigable(menus: string[], disabled: string[]): string[] {
  return menus.filter((id) => !disabled.includes(id))
}

function nextMenu(
  menus: string[],
  disabled: string[],
  from: string | null,
  delta: 1 | -1,
): string | null {
  const nav = navigable(menus, disabled)
  if (nav.length === 0) return null
  const start = from === null ? -1 : nav.indexOf(from)
  const n = nav.length
  const idx = start === -1 && delta === 1 ? 0 : (((start + delta) % n) + n) % n
  return nav[idx]!
}

function setMenuState(
  states: Record<string, MenuState>,
  id: string,
  next: MenuState,
): Record<string, MenuState> {
  return { ...states, [id]: next }
}

/** Open menu `id`, closing whichever menu is currently open. */
function openMenuState(state: MenubarState, id: string): MenubarState {
  if (state.disabledMenus.includes(id)) return state
  let states = state.menuStates
  // Close the currently-open menu (if a different one).
  if (state.open && state.open !== id) {
    const prev = states[state.open]
    if (prev && prev.open) {
      states = setMenuState(states, state.open, menuUpdate(prev, { type: 'close' })[0])
    }
  }
  const current = states[id]
  if (!current) return state
  const opened = menuUpdate(current, { type: 'open' })[0]
  return {
    ...state,
    open: id,
    focused: id,
    menuStates: setMenuState(states, id, opened),
  }
}

export function update(state: MenubarState, msg: MenubarMsg): [MenubarState, never[]] {
  switch (msg.type) {
    case 'openMenu':
      return [openMenuState(state, msg.id), []]
    case 'closeMenu': {
      if (!state.open) return [state, []]
      const current = state.menuStates[state.open]
      const menuStates = current
        ? setMenuState(state.menuStates, state.open, menuUpdate(current, { type: 'close' })[0])
        : state.menuStates
      return [{ ...state, open: null, menuStates }, []]
    }
    case 'focusMenu': {
      if (state.disabledMenus.includes(msg.id)) return [state, []]
      // Open mode: if a menu is already open, switch the open menu.
      if (state.open) return [openMenuState(state, msg.id), []]
      return [{ ...state, focused: msg.id }, []]
    }
    case 'focusNext': {
      const to = nextMenu(state.menus, state.disabledMenus, state.focused, 1)
      if (to === null) return [state, []]
      if (state.open) return [openMenuState(state, to), []]
      return [{ ...state, focused: to }, []]
    }
    case 'focusPrev': {
      const to = nextMenu(state.menus, state.disabledMenus, state.focused, -1)
      if (to === null) return [state, []]
      if (state.open) return [openMenuState(state, to), []]
      return [{ ...state, focused: to }, []]
    }
    case 'menuMsg': {
      const current = state.menuStates[msg.id]
      if (!current) return [state, []]
      const next = menuUpdate(current, msg.msg)[0]
      const menuStates = setMenuState(state.menuStates, msg.id, next)
      // If the delegated msg closed the menu, clear the top-level open marker.
      const open = state.open === msg.id && !next.open ? null : state.open
      return [{ ...state, open, menuStates }, []]
    }
  }
}

// ---- connect ----

export interface MenubarTriggerParts {
  role: 'menuitem'
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': Signal<boolean>
  'aria-controls': string
  'aria-disabled': Signal<'true' | undefined>
  'data-scope': 'menubar'
  'data-part': 'trigger'
  'data-state': Signal<'open' | 'closed'>
  'data-value': string
  tabindex: Signal<number>
  onClick: (e: MouseEvent) => void
  onPointerEnter: (e: PointerEvent) => void
  onFocus: (e: FocusEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface MenubarParts {
  root: {
    role: 'menubar'
    'aria-label': string
    'data-scope': 'menubar'
    'data-part': 'root'
  }
  menuTrigger: (id: string) => MenubarTriggerParts
  /** Delegated per-menu part bag (content/item/checkboxItem/submenu/…). */
  menu: (id: string) => MenuParts
}

export interface ConnectOptions {
  id: string
  label?: string
  /** Called when an item in any menu is activated (Enter/Space/click). */
  onSelect?: (menuId: string, value: string) => void
}

export function connect(
  state: Signal<MenubarState>,
  send: Send<MenubarMsg>,
  opts: ConnectOptions,
): MenubarParts {
  const base = opts.id
  const triggerId = (id: string): string => `${base}:trigger:${id}`

  // A per-menu Send that wraps each MenuMsg in a `menuMsg` envelope so the
  // delegated menu.connect drives the embedded machine.
  const menuSend = (id: string): Send<MenuMsg> => {
    const wrapped = ((m: MenuMsg) => send({ type: 'menuMsg', id, msg: m })) as Send<MenuMsg>
    return wrapped
  }

  // A per-menu Signal narrowed to the embedded MenuState.
  const menuSignal = (id: string): Signal<MenuState> =>
    state.map((s) => s.menuStates[id] ?? menuInit())

  return {
    root: {
      role: 'menubar',
      'aria-label': opts.label ?? 'Menu',
      'data-scope': 'menubar',
      'data-part': 'root',
    },
    menuTrigger: (id: string): MenubarTriggerParts => ({
      role: 'menuitem',
      id: triggerId(id),
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.open === id),
      'aria-controls': `${base}:${id}:content`,
      'aria-disabled': state.map((s) => (s.disabledMenus.includes(id) ? 'true' : undefined)),
      'data-scope': 'menubar',
      'data-part': 'trigger',
      'data-state': state.map((s) => (s.open === id ? 'open' : 'closed')),
      'data-value': id,
      tabindex: state.map((s) => (s.focused === id ? 0 : -1)),
      onClick: tagSend(send, ['openMenu', 'closeMenu'], () => {
        if (state.peek()?.open === id) {
          send({ type: 'closeMenu' })
        } else {
          send({ type: 'openMenu', id })
        }
      }),
      onPointerEnter: tagSend(send, ['focusMenu'], () => {
        // Open mode only: once any menu is open, hovering a sibling switches it.
        if (state.peek()?.open != null) {
          send({ type: 'focusMenu', id })
        }
      }),
      onFocus: tagSend(send, ['focusMenu'], () => send({ type: 'focusMenu', id })),
      onKeyDown: tagSend(send, ['focusNext', 'focusPrev', 'openMenu'], (e: KeyboardEvent) => {
        const origin = e.currentTarget as Element | null
        // After roving the focused trigger in state, move REAL DOM focus to it —
        // arrow keys are otherwise silent for assistive tech.
        const moveFocus = (): void => {
          const focused = state.peek()?.focused
          if (focused != null) focusRovingItem(origin, 'menubar', focused, { itemPart: 'trigger' })
        }
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            send({ type: 'focusNext' })
            moveFocus()
            return
          case 'ArrowLeft':
            e.preventDefault()
            send({ type: 'focusPrev' })
            moveFocus()
            return
          case 'ArrowDown':
          case 'Enter':
          case ' ':
            e.preventDefault()
            send({ type: 'openMenu', id })
            return
        }
      }),
    }),
    menu: (id: string): MenuParts =>
      menuConnect(menuSignal(id), menuSend(id), {
        id: `${base}:${id}`,
        onSelect: opts.onSelect ? (value) => opts.onSelect!(id, value) : undefined,
      }),
  }
}

// ---- overlay (per-menu) ----

export interface MenubarOverlayOptions {
  state: Signal<MenubarState>
  send: Send<MenubarMsg>
  /** The menu id this overlay renders. */
  menuId: string
  parts: MenuParts
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  target?: string | HTMLElement
}

/**
 * Render one top-level menu's dropdown. Mirrors `menu.overlay` but is gated on
 * `state.open === menuId` and dismisses by closing the menubar (returning
 * focus to the top-level trigger). Submenu unwinding goes through the same
 * dismissable stack the menu machine uses.
 */
export function overlay(opts: MenubarOverlayOptions): Mountable {
  const host = resolvePortalTarget(opts.target ?? 'body')
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show(
    opts.state.map((s) => s.open === opts.menuId),
    () => {
      return [
        portal(() => {
          const dismissable = onMount((root) => {
            const contentEl = getElementByIdInScope(root, contentId)
            const triggerEl = getElementByIdInScope(root, triggerId)
            if (!contentEl) return

            const cleanups: Array<() => void> = []

            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            cleanups.push(
              attachFloating({
                anchor: triggerEl ?? contentEl,
                floating: floatingEl,
                placement,
                offset,
                flip,
                shift,
              }),
            )

            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => (triggerEl ? [triggerEl] : []),
                // Focus restoration lives in the cleanup below (runs on EVERY
                // close, including item-select), so don't also focus here.
                onDismiss: () => opts.send({ type: 'closeMenu' }),
              }),
            )

            contentEl.focus({ preventScroll: true })

            return () => {
              // Restore focus to the menu's trigger when focus is still inside
              // the overlay (e.g. after selecting an item, which would otherwise
              // drop focus to <body>). Respect focus the user moved elsewhere.
              const active = document.activeElement
              const focusInside =
                contentEl.contains(active) || active === document.body || active === null
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
              if (focusInside) triggerEl?.focus()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, host),
      ]
    },
  )
}

export const menubar = { init, update, connect, overlay }
