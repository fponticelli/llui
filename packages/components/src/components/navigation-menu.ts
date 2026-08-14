import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { flipArrow } from '../utils/direction.js'
import { onScopeTeardown } from '../utils/lifecycle.js'
import { rovingTabStop } from '../utils/list-navigation.js'
import { deriveOnceN } from '../utils/derive.js'

/** No navigation-menu item is individually disabled; the whole nav is or isn't. */
const NO_DISABLED: readonly string[] = []

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
  /**
   * Ids of the items ELIGIBLE for the roving tab stop, in document order, when
   * the consumer renders a DYNAMIC list — the top-level items in the usual
   * case; add deeper ids if a submenu item should be able to own the stop.
   *
   * It is both the fallback and the membership list: while nothing is focused
   * the first entry owns the nav's single tab stop, and a `focused` id that is
   * not one of these entries has been removed, so the stop falls back rather
   * than vanishing (#145).
   *
   * Leave it empty for a static menu — `connect` then trusts `focused` and
   * falls back to the first id handed to `item()`, which is document order for
   * any depth-first view. Same escape hatch as `radio-group`/`tabs`, which keep
   * their `items` list in state for exactly this reason.
   */
  items: string[]
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
  /** @intent("Replace the list of ids eligible for the roving tab stop, in document order") */
  | { type: 'setItems'; items: string[] }

export interface NavMenuInit {
  open?: string[]
  focused?: string | null
  /** Ids eligible for the roving tab stop, in document order — see
   *  `NavMenuState.items`. */
  items?: string[]
  disabled?: boolean
  dir?: 'ltr' | 'rtl'
}

export function init(opts: NavMenuInit = {}): NavMenuState {
  return {
    open: opts.open ?? [],
    focused: opts.focused ?? null,
    items: opts.items ?? [],
    disabled: opts.disabled ?? false,
    dir: opts.dir ?? 'ltr',
  }
}

export function update(state: NavMenuState, msg: NavMenuMsg): [NavMenuState, never[]] {
  if (msg.type === 'setDir') return [{ ...state, dir: msg.dir }, []]
  // Accepted while disabled: it is presentation order, not an interaction.
  if (msg.type === 'setItems') return [{ ...state, items: msg.items }, []]
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

  // Cancel a still-pending close when the nav unmounts. The guard above already
  // makes a late timer HARMLESS; this makes it not exist. Best-effort:
  // `connect()` is also called from unit tests with no build context, where
  // there is no scope to hook and the guard is the whole story (#123).
  onScopeTeardown(cancelClose)

  // Roving-tabindex fallback. `focused` starts null and only a trigger's own
  // onFocus ever sets it, so with a bare `focused === id ? 0 : -1` EVERY trigger
  // reads -1 on the default state and the whole nav is unreachable by Tab —
  // WCAG 2.1.1 (#122). The siblings that solve this (radio-group, tabs,
  // menubar) fall back to the first enabled item in their `items` list, but
  // this machine deliberately does not index the tree: the consumer owns it.
  // So the fallback comes from `state.items` when the consumer maintains it —
  // the current top-level order, so a list rendered through `each` re-seats the
  // tab stop as rows come and go.
  //
  // `firstItemId` is the STATIC-MENU fallback only: the first id handed to
  // `item()`, which for any depth-first view is the first trigger in document
  // order. It is a LATCH, and a latch is wrong for a dynamic list — `item()`
  // runs once per row build, so removing the row that happened to build first
  // leaves the latch pointing at an id that no longer exists and the nav loses
  // its tab stop entirely. `state.items` therefore WINS wherever it is
  // populated; the latch only answers when it is empty.
  //
  // Where `state.items` IS populated it is also the MEMBERSHIP list, so the
  // stop goes through the shared `rovingTabStop` (#145): `focused` is honoured
  // only while it still names one of the current items, and the first item
  // answers otherwise. Without that pruning, removing the focused item — or
  // `setItems` dropping it — left every trigger at -1 all over again, since
  // nothing ever clears `focused`.
  //
  // With an EMPTY `items` the machine knows no membership at all (it
  // deliberately does not index the tree), so `focused` is taken on trust and
  // the latch answers only while nothing is focused. That is the case a static
  // menu is in, and it is why the routing is conditional: pruning `focused`
  // against a list of one latched id would strip the stop from every trigger
  // but the first.
  let firstItemId: string | null = null
  const stopId = deriveOnceN(
    (items: string[], focused: string | null, latched: string | null): string | null =>
      items.length > 0
        ? rovingTabStop(items, NO_DISABLED, focused)
        : focused !== null
          ? focused
          : latched,
  )
  const tabStop = (id: string) => (st: NavMenuState) =>
    stopId(st.items, st.focused, firstItemId) === id ? 0 : -1

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
