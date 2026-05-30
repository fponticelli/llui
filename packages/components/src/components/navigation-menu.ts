import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'

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

export interface NavMenuInit {
  open?: string[]
  focused?: string | null
  disabled?: boolean
}

export function init(opts: NavMenuInit = {}): NavMenuState {
  return {
    open: opts.open ?? [],
    focused: opts.focused ?? null,
    disabled: opts.disabled ?? false,
  }
}

export function update(state: NavMenuState, msg: NavMenuMsg): [NavMenuState, never[]] {
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
    role: 'menuitem'
    id: string
    'aria-haspopup': 'menu' | undefined
    'aria-expanded': Signal<boolean | undefined>
    'data-scope': 'navigation-menu'
    'data-part': 'trigger'
    'data-state': Signal<'open' | 'closed'>
    'data-value': string
    tabIndex: Signal<number>
    onClick: (e: MouseEvent) => void
    onPointerEnter: (e: PointerEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  content: {
    role: 'menu'
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
    role: 'menubar'
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

  const scheduleClose = (): void => {
    if (!closeOnLeave) return
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      send({ type: 'closeAll' })
      closeTimer = null
    }, 150)
  }

  const cancelClose = (): void => {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  return {
    root: {
      role: 'menubar',
      'aria-label': opts.label ?? locale.navigationMenu.label,
      'data-scope': 'navigation-menu',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
      onPointerLeave: () => scheduleClose(),
      onPointerEnter: () => cancelClose(),
    },
    item: (id: string, options: { isBranch: boolean; ancestorIds?: string[] }): NavItemParts => {
      const ancestorIds = options.ancestorIds ?? []
      return {
        trigger: {
          type: 'button',
          role: 'menuitem',
          id: triggerId(id),
          'aria-haspopup': options.isBranch ? 'menu' : undefined,
          'aria-expanded': state.map((st) => (options.isBranch ? isOpen(st, id) : undefined)),
          'data-scope': 'navigation-menu',
          'data-part': 'trigger',
          'data-state': state.map((st) => (isOpen(st, id) ? 'open' : 'closed')),
          'data-value': id,
          tabIndex: state.map((st) => (st.focused === id ? 0 : -1)),
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
        },
        content: {
          role: 'menu',
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
