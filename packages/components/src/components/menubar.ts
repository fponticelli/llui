import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { mapSend, tagSend } from '@llui/dom'
import { type Placement } from '../utils/floating.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
import { focusRovingItem } from '../utils/roving.js'
import { firstEnabled, rovingTabStop } from '../utils/list-navigation.js'
import { deriveOnceN } from '../utils/derive.js'
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
 *
 * ```ts
 * view: ({ state, send }) => {
 *   const menubarState = state.at('menubar')
 *   const menubarSend = mapSend<Msg, menubar.MenubarMsg>(send, (msg) => ({
 *     type: 'menubar',
 *     msg,
 *   }))
 *   const parts = menubar.connect(menubarState, menubarSend, { id: 'main-menu' })
 *   // spread `parts.root`, `parts.menuTrigger(id)`, and `parts.menu(id)` onto the view
 * }
 * ```
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

  // The bar carries EXACTLY ONE tab stop: the focused trigger, or the first
  // enabled menu when `focused` no longer names one. `focused` is never pruned
  // against `menus`/`disabledMenus`, so the inline `s.focused === id ? 0 : -1`
  // this replaces left EVERY trigger at -1 once the focused menu was removed or
  // disabled — the menubar dropped out of the Tab order entirely and, having no
  // other focusable element, became keyboard-unreachable (WCAG 2.1.1, #145).
  // The fallback belongs in the shared helper, not in a remembered id.
  // Answered ONCE per update and shared by every trigger (#124).
  //
  // ONE DISCLOSED REGRESSION, 1 -> 0 stops: with EVERY menu disabled the old
  // inline form still gave the focused trigger a 0, and `rovingTabStop` returns
  // null when nothing is enabled, so no trigger carries one. Triggers are
  // disabled with `aria-disabled` only, so they stay focusable and a stop there
  // was reachable. Kept as-is on three grounds: it is `rovingTabStop`'s
  // documented contract and `radio-group` has behaved this way since #126, so
  // fixing it here alone would re-split the rule the helper exists to unify;
  // an all-disabled composite has nothing to operate and WAI-ARIA's "at least
  // one tab stop" presumes an operable widget; and no message mutates `menus`
  // or `disabledMenus`, so reaching the state needs an explicit
  // `init({ focused })` over an all-disabled bar. A fix belongs in the shared
  // helper, for every caller at once.
  const stopId = deriveOnceN((menus: string[], disabled: string[], focused: string | null) =>
    rovingTabStop(menus, disabled, focused),
  )

  // A per-menu Send that wraps each MenuMsg in a `menuMsg` envelope so the
  // delegated menu.connect drives the embedded machine.
  const menuSend = (id: string): Send<MenuMsg> =>
    mapSend<MenubarMsg, MenuMsg>(send, (msg) => ({ type: 'menuMsg', id, msg }))

  // A per-menu Signal narrowed to the embedded MenuState.
  const menuSignal = (id: string): Signal<MenuState> =>
    state.map((s) => s.menuStates[id] ?? menuInit())

  // ONE delegated bag per menu id, memoized. Two reasons it must be memoized
  // rather than rebuilt per call:
  //   1. `menuTrigger(id)` below takes the bar trigger's `id` and `aria-controls`
  //      FROM this bag, so the id the bar RENDERS and the id `overlay()` anchors
  //      on (`parts.trigger.id`) are the same string by construction. They used
  //      to be computed independently and disagreed — the overlay anchored on an
  //      element nothing rendered, which killed positioning, click-to-close and
  //      focus restore (#121).
  //   2. Each bag owns its own hover-intent submenu timers; a fresh bag per call
  //      would scatter them across instances that no longer back any element.
  const menuBags = new Map<string, MenuParts>()
  const menuBag = (id: string): MenuParts => {
    let bag = menuBags.get(id)
    if (bag === undefined) {
      bag = menuConnect(menuSignal(id), menuSend(id), {
        id: `${base}:${id}`,
        onSelect: opts.onSelect ? (value) => opts.onSelect!(id, value) : undefined,
      })
      menuBags.set(id, bag)
    }
    return bag
  }

  return {
    root: {
      role: 'menubar',
      'aria-label': opts.label ?? 'Menu',
      'data-scope': 'menubar',
      'data-part': 'root',
    },
    menuTrigger: (id: string): MenubarTriggerParts => ({
      role: 'menuitem',
      // Both ids come from the delegated bag — see `menuBag` (#121).
      id: menuBag(id).trigger.id,
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.open === id),
      'aria-controls': menuBag(id).content.id,
      'aria-disabled': state.map((s) => (s.disabledMenus.includes(id) ? 'true' : undefined)),
      'data-scope': 'menubar',
      'data-part': 'trigger',
      'data-state': state.map((s) => (s.open === id ? 'open' : 'closed')),
      'data-value': id,
      tabindex: state.map((s) => (stopId(s.menus, s.disabledMenus, s.focused) === id ? 0 : -1)),
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
    menu: menuBag,
  }
}

// ---- overlay (per-menu) ----

export interface MenubarOverlayOptions {
  state: Signal<MenubarState>
  send: Send<MenubarMsg>
  /** The menu id this overlay renders. */
  menuId: string
  /** The delegated per-menu bag — `connect(...).menu(menuId)`. Its
   * `trigger.id` is the id the bar's `menuTrigger(menuId)` renders, so it
   * doubles as the overlay's anchor. */
  parts: MenuParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the menubar menu content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Keep `skipAnimations` at its default (true) when driving exits this way.
   *
   * @example menubar.overlay({ state, send, parts, content, transition: fade({ duration: 120 }) })
   */
  transition?: TransitionOptions
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
  // Gated on `state.open === menuId`; dismisses by closing the menubar (which
  // returns focus to the top-level trigger). `parts.trigger.id` is the id the
  // bar renders for this menu (both come from the one memoized delegated bag —
  // see `menuBag` in connect), so it anchors the floating position, keeps the
  // trigger out of the outside-click boundary (click-to-close instead of
  // close-then-reopen) and gives focus restore a target.
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    anchorId: opts.parts.trigger.id,
    mountWhen: (s) => s.open === opts.menuId,
    onDismiss: () => opts.send({ type: 'closeMenu' }),
    floating: {
      placement: opts.placement ?? 'bottom-start',
      offset: opts.offset ?? 4,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
    },
    dismiss: {
      // Escape unwinds ONE submenu level of the currently-open menu before
      // closing the menu itself (which returns focus to its top-level trigger).
      onEscape: () => {
        const s = opts.state.peek()
        const openId = s.open
        const sub = openId ? s.menuStates[openId] : undefined
        if (openId && sub && sub.openPath.length > 0) {
          opts.send({ type: 'menuMsg', id: openId, msg: { type: 'closeSub' } })
        } else {
          opts.send({ type: 'closeMenu' })
        }
      },
    },
    focusOnOpenId: opts.parts.content.id,
    restoreFocus: { boundary: 'content' },
  })
}

export const menubar = { init, update, connect, overlay }
