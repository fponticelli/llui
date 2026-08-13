import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { flipArrow } from '../utils/direction.js'

/**
 * Navigation menu — multi-level menu bar with hover/focus-triggered
 * submenus. Unlike `menu` (a single dropdown), navigation-menu supports
 * nested submenus arbitrarily deep and is typically used for primary
 * site navigation.
 *
 * State tracks the currently focused item id and the ids of all
 * currently-open branches. The consumer provides the tree structure
 * (items with optional children); the machine doesn't index the
 * hierarchy itself — it just maintains open-paths and lets the view
 * handle traversal.
 *
 * Typical interaction model (delay-based):
 *   - Pointer enter on a branch → openBranch after openDelay
 *   - Pointer leave of the whole tree → closeAll after closeDelay
 *   - Click/keyboard activation → toggleBranch immediately
 *
 * The consumer is responsible for debouncing via setTimeout; the machine
 * just responds to the dispatched messages.
 */

export interface NavMenuState {
  /** Ids of open branches, in open order (root-first). Closing an
   *  ancestor automatically closes its descendants. */
  open: string[]
  focused: string | null
  disabled: boolean
  /** Reading direction. Under 'rtl', ArrowLeft/ArrowRight swap meaning. */
  dir: 'ltr' | 'rtl'
}

export type NavMenuMsg =
  /** @intent("Open the submenu identified by id, closing any open siblings") */
  | { type: 'openBranch'; id: string; ancestorIds: string[] }
  /** @intent("Close the submenu identified by id (also closes its descendants)") */
  | { type: 'closeBranch'; id: string }
  /** @intent("Toggle the submenu identified by id open/closed") */
  | { type: 'toggleBranch'; id: string; ancestorIds: string[] }
  /** @intent("Close every open submenu") */
  | { type: 'closeAll' }
  /** @humanOnly */
  | { type: 'focus'; id: string | null }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }

export interface NavMenuInit {
  open?: string[]
  focused?: string | null
  disabled?: boolean
  dir?: 'ltr' | 'rtl'
}

export function init(opts: NavMenuInit = {}): NavMenuState {
  return {
    open: opts.open ?? [],
    focused: opts.focused ?? null,
    disabled: opts.disabled ?? false,
    dir: opts.dir ?? 'ltr',
  }
}

export function update(state: NavMenuState, msg: NavMenuMsg): [NavMenuState, never[]] {
  if (msg.type === 'setDir') return [{ ...state, dir: msg.dir }, []]
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'openBranch': {
      // Close any siblings of `id` at the same ancestor path, then add it.
      // Sibling detection: an entry is a sibling if its ancestor set matches
      // msg.ancestorIds and it isn't msg.id. We don't track ancestors in
      // state, so: filter `open` to keep only entries that are themselves
      // an ancestor of msg.id, plus msg.id.
      const keep = new Set([...msg.ancestorIds, msg.id])
      const open = state.open.filter((o) => keep.has(o))
      if (!open.includes(msg.id)) open.push(msg.id)
      return [{ ...state, open }, []]
    }
    case 'closeBranch': {
      // Close this branch and any descendants that follow it in the open
      // list. Since open is ordered root-first, descendants come after.
      const idx = state.open.indexOf(msg.id)
      if (idx === -1) return [state, []]
      const open = state.open.slice(0, idx)
      return [{ ...state, open }, []]
    }
    case 'toggleBranch':
      if (state.open.includes(msg.id)) {
        return update(state, { type: 'closeBranch', id: msg.id })
      }
      return update(state, { type: 'openBranch', id: msg.id, ancestorIds: msg.ancestorIds })
    case 'closeAll':
      return [{ ...state, open: [] }, []]
    case 'focus':
      return [{ ...state, focused: msg.id }, []]
  }
}

export function isOpen(state: NavMenuState, id: string): boolean {
  return state.open.includes(id)
}

export interface NavItemParts {
  trigger: {
    type: 'button'
    id: string
    /** For a branch item this is the disclosure button controlling its panel;
     * `undefined` for a plain link trigger. */
    'aria-controls': string | undefined
    'aria-expanded': Signal<boolean | undefined>
    'data-scope': 'navigation-menu'
    'data-part': 'trigger'
    'data-state': Signal<'open' | 'closed'>
    'data-value': string
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onPointerEnter: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  content: {
    id: string
    'aria-labelledby': string
    'data-scope': 'navigation-menu'
    'data-part': 'content'
    'data-state': Signal<'open' | 'closed'>
    hidden: Signal<boolean>
    onPointerEnter: (e: PointerEvent) => void
  }
}

export interface NavMenuParts {
  root: {
    // Site navigation is NOT an application menu: it uses a `nav` landmark with
    // disclosure buttons, not menubar/menu/menuitem roles. Render the root as a
    // `<nav>` element; `aria-label` names the landmark.
    'aria-label': string
    'data-scope': 'navigation-menu'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    onPointerLeave: (e: PointerEvent) => void
    onPointerEnter: (e: PointerEvent) => void
  }
  item: (id: string, options: { isBranch: boolean; ancestorIds?: string[] }) => NavItemParts
}

export interface ConnectOptions {
  id: string
  label?: string
  /**
   * Whether pointer-leaving the whole menu closes everything. Default: true.
   * The consumer can inject their own close delay by intercepting
   * onPointerLeave + calling setTimeout + dispatching closeAll.
   */
  closeOnLeave?: boolean
}

export function connect(
  state: Signal<NavMenuState>,
  send: Send<NavMenuMsg>,
  opts: ConnectOptions,
): NavMenuParts {
  const locale = useContext(LocaleContext)
  const triggerId = (v: string): string => `${opts.id}:trigger:${v}`
  const contentId = (v: string): string => `${opts.id}:content:${v}`
  const closeOnLeave = opts.closeOnLeave !== false
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  // A pending close timer must not act after the menu unmounts, or it dispatches
  // to a disposed handle. Capture THIS instance's root at schedule time; if it
  // was live then but is detached when the timer fires, the menu unmounted —
  // drop it. The root comes from the event's `currentTarget`: a
  // `document.querySelector('[data-scope="navigation-menu"]…')` picks the first
  // nav in DOCUMENT ORDER, so a second instance checked the FIRST one's liveness
  // and happily dispatched into its own disposed handle (#123). (No element at
  // all, e.g. a unit test dispatching a bare object → no guard.)
  const detached = (el: Element | null): boolean => el !== null && !el.isConnected
  const eventRoot = (e: { currentTarget?: EventTarget | null } | undefined): Element | null => {
    const t = e?.currentTarget
    return t instanceof Element ? t : null
  }

  const scheduleClose = (root: Element | null): void => {
    if (!closeOnLeave) return
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      closeTimer = null
      if (!detached(root)) send({ type: 'closeAll' })
    }, 150)
  }

  const cancelClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  // Roving-tabindex fallback. `focused` starts null and only a trigger's own
  // onFocus ever sets it, so with a bare `focused === id ? 0 : -1` EVERY trigger
  // reads -1 on the default state and the whole nav is unreachable by Tab —
  // WCAG 2.1.1 (#122). The siblings that solve this (radio-group, tabs,
  // menubar) fall back to the first enabled item in their `items` list, but
  // this machine deliberately does not index the tree: the consumer owns it.
  // So `connect` remembers the FIRST id handed to `item()`, which for any
  // depth-first view is the first trigger in document order, and gives it the
  // tab stop while nothing is focused.
  let firstItemId: string | null = null
  const tabStop = (id: string) => (st: NavMenuState) => {
    if (st.focused !== null) return st.focused === id ? 0 : -1
    return firstItemId === id ? 0 : -1
  }

  return {
    root: {
      'aria-label': opts.label ?? locale.navigationMenu.label,
      'data-scope': 'navigation-menu',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
      onPointerLeave: (e: PointerEvent) => scheduleClose(eventRoot(e)),
      onPointerEnter: () => cancelClose(),
    },
    item: (id: string, options: { isBranch: boolean; ancestorIds?: string[] }): NavItemParts => {
      const ancestorIds = options.ancestorIds ?? []
      if (firstItemId === null) firstItemId = id
      return {
        trigger: {
          type: 'button',
          id: triggerId(id),
          // Disclosure button: aria-expanded + aria-controls tie it to its panel.
          'aria-controls': options.isBranch ? contentId(id) : undefined,
          'aria-expanded': state.map((st) => (options.isBranch ? isOpen(st, id) : undefined)),
          'data-scope': 'navigation-menu',
          'data-part': 'trigger',
          'data-state': state.map((st) => (isOpen(st, id) ? 'open' : 'closed')),
          'data-value': id,
          tabindex: state.map(tabStop(id)),
          onClick: tagSend(send, ['toggleBranch'], () => {
            if (options.isBranch) {
              send({ type: 'toggleBranch', id, ancestorIds })
            }
          }),
          onPointerEnter: tagSend(send, ['openBranch'], () => {
            cancelClose()
            if (options.isBranch) {
              send({ type: 'openBranch', id, ancestorIds })
            }
          }),
          onFocus: tagSend(send, ['focus'], () => send({ type: 'focus', id })),
          // Horizontal arrows move along the menubar; under rtl ArrowLeft/
          // ArrowRight swap meaning (logical ArrowRight = forward/open,
          // logical ArrowLeft = back/close). Vertical ArrowDown also opens a
          // branch and is never flipped.
          onKeyDown: tagSend(send, ['openBranch', 'closeBranch'], (e: KeyboardEvent) => {
            if (!options.isBranch) return
            const key = flipArrow(e.key, state.peek().dir)
            if (key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              send({ type: 'openBranch', id, ancestorIds })
            } else if (key === 'ArrowLeft') {
              e.preventDefault()
              send({ type: 'closeBranch', id })
            }
          }),
        },
        content: {
          id: contentId(id),
          'aria-labelledby': triggerId(id),
          'data-scope': 'navigation-menu',
          'data-part': 'content',
          'data-state': state.map((st) => (isOpen(st, id) ? 'open' : 'closed')),
          hidden: state.map((st) => !isOpen(st, id)),
          onPointerEnter: tagSend(send, ['openBranch'], () => {
            cancelClose()
            if (options.isBranch) {
              send({ type: 'openBranch', id, ancestorIds })
            }
          }),
        },
      }
    },
  }
}

export const navigationMenu = { init, update, connect, isOpen }
