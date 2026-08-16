import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { navigationMenuLocale } from '../locale/navigation-menu.js'
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
   * Leave it empty for a static menu — `connect` then uses the ids handed to
   * `item()`, in call order, as the membership list instead, which is document
   * order for any depth-first view. Same escape hatch as `radio-group`/`tabs`,
   * which keep their `items` list in state for exactly this reason.
   *
   * Either way the candidates are filtered to the ones currently TABBABLE: an
   * id whose `ancestorIds` are not all in `open` sits inside a `hidden`
   * submenu panel and cannot carry the stop.
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
  /**
   * Parts for one trigger (+ its panel when it is a branch).
   *
   * `ancestorIds` is the open-path this item lives under, root-first. It drives
   * sibling-closing in `openBranch` AND the roving tab stop: an item whose
   * ancestors are not all open is inside a `hidden` panel and is skipped when
   * the stop is resolved.
   *
   * REQUIRED on every NESTED item, leaf ones included. It used to be read only
   * inside `isBranch` guards, so passing it on a leaf was optional in practice;
   * since #145 it is what makes a leaf's tabbability knowable. Omitting it
   * reads as "top level", which lets the tab stop sit inside a closed submenu
   * where no Tab press can reach it.
   */
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
  const locale = navigationMenuLocale()
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
  //
  // `state.items` is the membership list wherever the consumer maintains it —
  // the current top-level order, so a list rendered through `each` re-seats the
  // tab stop as rows come and go — and the stop goes through the shared
  // `rovingTabStop` (#145): `focused` is honoured only while it still names one
  // of the current items, and the first item answers otherwise. Without that
  // pruning, removing the focused item — or `setItems` dropping it — left every
  // trigger at -1 all over again, since nothing ever clears `focused`.
  //
  // With an EMPTY `items` — the documented STATIC-menu configuration — the
  // machine indexes no tree of its own, so the membership list is the one
  // `connect` builds for itself: `rendered`, every id handed to `item()`, in
  // call order (document order for any depth-first view). It replaces the
  // single-id LATCH this used to carry, which was wrong in BOTH directions: it
  // answered only while nothing was focused, so a `focused` id naming nothing
  // rendered still owned the stop and every trigger read -1 (#145's own
  // `focused === x ? 0 : -1` failure, one level up), and as a fallback it
  // pinned whichever row happened to build first even after that row was gone.
  // A full list is never worse than the latch — its first entry IS the latch —
  // and it prunes a stale `focused` the latch could not.
  //
  // `rendered` ACCUMULATES AND NEVER PRUNES, and only the FIRST of those two
  // latch defects is therefore fixed. A row that unmounts — an `each` row
  // removed, a `show`-gated trigger switched off — stays in the map with its
  // ancestors, so with an EMPTY `items` the fallback can still name an id that
  // is no longer in the DOM and the nav ends up with zero stops, exactly as the
  // latch could. Nothing here can fix that: `item()` is the only signal this
  // code gets and it is build-only, so an unmount is invisible. It is not a
  // regression (identical on the pre-#145 code and on this one) and the answer
  // is the documented one — a menu whose triggers come and go is a DYNAMIC list
  // and owes `state.items`, which is pruned by the consumer and wins here. Keep
  // the accumulation: a build-time deregistration hook would have to fire on
  // arm teardown, which `connect()` cannot observe.
  //
  // MEMBERSHIP IS NOT ENOUGH: the tab stop must sit on something TABBABLE, and
  // a submenu entry is only tabbable while every branch above it is open (its
  // `content` carries `hidden: !isOpen`). Focus a submenu entry, then let the
  // pointer leave and `closeAll` fire, and a membership-only stop stayed on an
  // id inside a `hidden` container — the nav had NO tabbable element at all,
  // WCAG 2.1.1 again, reachable through the machine's own messages with no
  // consumer error. So `ancestorIds` is recorded per id and the candidate list
  // is filtered to the ids whose ancestors are all open. THIS IS NEW WEIGHT ON
  // AN EXISTING PARAMETER, not a free ride on one: `item()` has always taken
  // `ancestorIds`, but every prior read of it was inside an `isBranch` guard,
  // so on a nested LEAF it was genuinely dead and omitting it cost nothing.
  // Now it decides tabbability, and a consumer who omits it on a nested leaf
  // gets the old Repro B back (stop present, nothing tabbable). Not a
  // regression — that is the behaviour they already had — but the requirement
  // is real and is stated on `NavMenuParts.item`. An id `item()` never
  // saw (a member of `state.items` not yet built) is taken as visible: unknown
  // is not the same as hidden. If the filter empties the list the UNFILTERED
  // candidates answer, so hiding everything degrades to the old behaviour
  // rather than to no stop at all. THAT DEGRADE HAS ONE VISIBLE COST: it looks
  // at the candidate list, not at the DOM, so `items: ['a', 'b']` with both
  // inside a shut branch seats the stop on the hidden `a` even though the
  // branch's own trigger is rendered and tabbable — it was simply not declared
  // a candidate. Defensible for that input (the consumer named exactly two
  // eligible ids and both are away), but the candidates are only ever as good
  // as what `items` declares, which is the same limit as the paragraph above.
  //
  // The memo is keyed on the STATE inputs only and reads `rendered` from the
  // closure, which is load-bearing rather than an oversight: `item()` runs
  // during view construction while the tabindex bindings produce during
  // materialisation, and every authoring helper is a lazy `Mountable`, so the
  // registry is complete before the first binding evaluates. Where it is not
  // (a test that interleaves `item()` with reads, an `each` row built after
  // mount), every trigger in the pass still compares against ONE memoized
  // answer, so "exactly one tab stop" holds even against a half-built registry.
  // Adding a registry revision to the key would trade that invariant for a
  // freshness nothing needs — the next state change recomputes anyway.
  const rendered = new Map<string, readonly string[]>()
  const stopId = deriveOnceN(
    (items: string[], focused: string | null, open: string[]): string | null => {
      const candidates = items.length > 0 ? items : [...rendered.keys()]
      const openSet = new Set(open)
      const visible = candidates.filter((cid) => {
        const ancestors = rendered.get(cid)
        return ancestors === undefined || ancestors.every((a) => openSet.has(a))
      })
      return rovingTabStop(visible.length > 0 ? visible : candidates, NO_DISABLED, focused)
    },
  )
  const tabStop = (id: string) => (st: NavMenuState) =>
    stopId(st.items, st.focused, st.open) === id ? 0 : -1

  return {
    root: {
      'aria-label': opts.label ?? locale.label,
      'data-scope': 'navigation-menu',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
      onPointerLeave: (e: PointerEvent) => scheduleClose(eventRoot(e)),
      onPointerEnter: () => cancelClose(),
    },
    item: (id: string, options: { isBranch: boolean; ancestorIds?: string[] }): NavItemParts => {
      const ancestorIds = options.ancestorIds ?? []
      // First call wins the position, so re-mounting a row keeps document
      // order; the ancestors are refreshed because a moved item can change
      // depth. Keying by id also bounds the registry to the DISTINCT ids ever
      // rendered rather than to the number of row builds.
      rendered.set(id, ancestorIds)
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
