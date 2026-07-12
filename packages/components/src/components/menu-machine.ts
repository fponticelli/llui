import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { presence, type PresenceStatus } from './presence.js'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

/**
 * Shared menu item-tree machine — the single source of truth behind `menu`,
 * `menubar` (via `menu.connect`), and `context-menu`. It owns:
 *
 *   - the JSON-serializable item tree ({@link MenuNode}) + pure traversal
 *     helpers (findItem / levelItems / navigable / first / last / next),
 *   - the presence-status transitions (statusOnOpen / statusOnClose),
 *   - the common reducer ({@link reduceMenuTree}) for every message shared by
 *     the two components (highlight family, typeahead, select / selectHighlighted,
 *     openSub / closeSub, setItems, setDir, animationEnd, close),
 *   - the hover-intent submenu timers, the memoized value→level resolver, and
 *   - the item / checkbox / radio / group / separator / submenu part builders,
 *     parameterized by a `scope` name so `data-scope` reads `'menu'` or
 *     `'context-menu'`.
 *
 * Each component keeps only what genuinely differs: its component-specific
 * messages (`open`/`toggle` vs `openAt`), its `isPresent`/`isVisible` predicates,
 * and its root trigger + content parts.
 */

/** Kind of a menu item. */
export type MenuNodeKind = 'action' | 'checkbox' | 'radio' | 'separator'

/** A single node in the menu item tree (JSON-serializable). `value`s must be
 * unique across the whole tree — they double as level keys and element ids. */
export interface MenuNode {
  value: string
  kind: MenuNodeKind
  /** Radio group key (radio items in the same group are mutually exclusive). */
  group?: string
  /** Child items — present on a parent that opens a submenu. */
  children?: MenuNode[]
  disabled?: boolean
}

/** The state fields every menu-tree component shares. Concrete component states
 * (MenuState / ContextMenuState) extend this with their own extras (e.g. x/y). */
export interface MenuTreeState {
  open: boolean
  status: PresenceStatus
  skipAnimations: boolean
  items: MenuNode[]
  /** Highlighted value per open level. Key `''` is the root; otherwise the parent subTrigger value. */
  highlights: Record<string, string | null>
  /** Chain of subTrigger values whose submenus are open (deepest last). */
  openPath: string[]
  /** Checked checkbox / radio values. */
  checked: string[]
  /** When true, selecting a checkbox/radio also closes the menu. */
  closeOnSelect: boolean
  typeahead: string
  typeaheadExpiresAt: number
  dir: 'ltr' | 'rtl'
}

/** The messages shared by every menu-tree component. Component-specific opens
 * (`open`/`toggle`/`openAt`) live in each component's own reducer. */
export type MenuTreeMsg =
  | { type: 'close' }
  | { type: 'highlight'; level: string; value: string | null }
  | { type: 'highlightNext'; level: string }
  | { type: 'highlightPrev'; level: string }
  | { type: 'highlightFirst'; level: string }
  | { type: 'highlightLast'; level: string }
  | { type: 'selectHighlighted'; level: string }
  | { type: 'select'; value: string }
  | { type: 'openSub'; value: string }
  | { type: 'closeSub' }
  | { type: 'setItems'; items: MenuNode[] }
  | { type: 'typeahead'; level: string; char: string; now: number }
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }
  | { type: 'animationEnd' }

// ---- presence lifecycle (composes presence.update; never reinvents it) ----

/** Advance the root content's presence status on an OPEN. With no enter
 * animation wired for menus, opening resolves directly to 'open'. */
export function statusOnOpen(status: PresenceStatus): PresenceStatus {
  const [next] = presence.update({ status, unmountOnExit: true }, { type: 'open' })
  return next.status === 'opening' ? 'open' : next.status
}

/** Advance the root content's presence status on a CLOSE REQUEST. With
 * skipAnimations the node unmounts synchronously ('closed'); otherwise it
 * enters 'closing' and stays mounted until `animationEnd`. */
export function statusOnClose(status: PresenceStatus, skipAnimations: boolean): PresenceStatus {
  if (skipAnimations) return 'closed'
  const [next] = presence.update({ status, unmountOnExit: true }, { type: 'close' })
  return next.status
}

// ---- item-tree helpers (pure) ----

/** Find an item by value anywhere in the tree, returning it (or null). */
export function findItem(items: MenuNode[], value: string): MenuNode | null {
  for (const it of items) {
    if (it.value === value) return it
    if (it.children) {
      const nested = findItem(it.children, value)
      if (nested) return nested
    }
  }
  return null
}

/** The list of items at a given level. `''` is the root; otherwise the children of that value. */
export function levelItems(items: MenuNode[], level: string): MenuNode[] {
  if (level === '') return items
  const parent = findItem(items, level)
  return parent?.children ?? []
}

/** Navigable values at a level: skip separators and disabled items. */
export function navigable(items: MenuNode[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.kind === 'separator') continue
    if (it.disabled) continue
    out.push(it.value)
  }
  return out
}

export function firstNav(items: MenuNode[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[0]! : null
}

export function lastNav(items: MenuNode[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[nav.length - 1]! : null
}

export function nextNav(items: MenuNode[], from: string | null, delta: 1 | -1): string | null {
  const nav = navigable(items)
  if (nav.length === 0) return null
  const start = from === null ? -1 : nav.indexOf(from)
  const n = nav.length
  const idx = start === -1 && delta === 1 ? 0 : (((start + delta) % n) + n) % n
  return nav[idx]!
}

export function isDisabled(items: MenuNode[], value: string): boolean {
  const it = findItem(items, value)
  return !!it?.disabled
}

export function setHighlight(
  highlights: Record<string, string | null>,
  level: string,
  value: string | null,
): Record<string, string | null> {
  return { ...highlights, [level]: value }
}

function toggleChecked(checked: string[], value: string): string[] {
  return checked.includes(value) ? checked.filter((v) => v !== value) : [...checked, value]
}

function collectGroupValues(items: MenuNode[], group: string): string[] {
  const out: string[] = []
  const walk = (list: MenuNode[]): void => {
    for (const it of list) {
      if (it.kind === 'radio' && it.group === group) out.push(it.value)
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return out
}

function selectRadio(items: MenuNode[], checked: string[], item: MenuNode): string[] {
  const group = item.group
  const siblings = group ? collectGroupValues(items, group) : [item.value]
  return [...checked.filter((v) => !siblings.includes(v)), item.value]
}

// ---- shared reducer ----

/** The state patch applied when a close request unmounts the menu. Routes the
 * presence status through `statusOnClose` so animations are honored. */
export function closedPatch(
  state: MenuTreeState,
): Pick<MenuTreeState, 'open' | 'status' | 'highlights' | 'openPath' | 'typeahead'> {
  return {
    open: false,
    status: statusOnClose(state.status, state.skipAnimations),
    highlights: { '': null },
    openPath: [],
    typeahead: '',
  }
}

/** Shared selection logic for `select` and `selectHighlighted`. */
function applySelect<S extends MenuTreeState>(state: S, value: string): [S, never[]] {
  const item = findItem(state.items, value)
  if (!item || item.disabled || item.kind === 'separator') return [state, []]

  // A parent with children opens its submenu rather than selecting.
  if (item.children && item.children.length > 0) {
    if (state.openPath[state.openPath.length - 1] === value) return [state, []]
    return [
      {
        ...state,
        openPath: [...state.openPath, value],
        highlights: setHighlight(state.highlights, value, firstNav(item.children)),
      },
      [],
    ]
  }

  if (item.kind === 'checkbox') {
    const checked = toggleChecked(state.checked, value)
    if (state.closeOnSelect) {
      return [{ ...state, checked, ...closedPatch(state) }, []]
    }
    return [{ ...state, checked }, []]
  }

  if (item.kind === 'radio') {
    const checked = selectRadio(state.items, state.checked, item)
    if (state.closeOnSelect) {
      return [{ ...state, checked, ...closedPatch(state) }, []]
    }
    return [{ ...state, checked }, []]
  }

  // action leaf: close the whole menu.
  return [{ ...state, ...closedPatch(state) }, []]
}

/**
 * Reduce a message shared by every menu-tree component, preserving any extra
 * component state fields (e.g. context-menu's x/y). Returns the SAME state
 * reference on a no-op so the reconciler can skip the commit.
 */
export function reduceMenuTree<S extends MenuTreeState>(state: S, msg: MenuTreeMsg): [S, never[]] {
  switch (msg.type) {
    case 'close':
      return [{ ...state, ...closedPatch(state) }, []]
    case 'highlight':
      // Open-only: a highlight arriving after close (e.g. a queued pointer
      // event) must not resurrect state on a closed menu.
      if (!state.open) return [state, []]
      if (msg.value !== null && isDisabled(state.items, msg.value)) return [state, []]
      // Pointer-move fires per tick — when the target is already highlighted,
      // return the SAME reference so the reconciler skips the commit.
      if ((state.highlights[msg.level] ?? null) === msg.value) return [state, []]
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, msg.value) }, []]
    case 'highlightNext': {
      if (!state.open) return [state, []]
      const to = nextNav(levelItems(state.items, msg.level), state.highlights[msg.level] ?? null, 1)
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, to) }, []]
    }
    case 'highlightPrev': {
      if (!state.open) return [state, []]
      const to = nextNav(
        levelItems(state.items, msg.level),
        state.highlights[msg.level] ?? null,
        -1,
      )
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, to) }, []]
    }
    case 'highlightFirst':
      if (!state.open) return [state, []]
      return [
        {
          ...state,
          highlights: setHighlight(
            state.highlights,
            msg.level,
            firstNav(levelItems(state.items, msg.level)),
          ),
        },
        [],
      ]
    case 'highlightLast':
      if (!state.open) return [state, []]
      return [
        {
          ...state,
          highlights: setHighlight(
            state.highlights,
            msg.level,
            lastNav(levelItems(state.items, msg.level)),
          ),
        },
        [],
      ]
    case 'openSub': {
      if (!state.open) return [state, []]
      const parent = findItem(state.items, msg.value)
      if (!parent || !parent.children || parent.disabled) return [state, []]
      return [
        {
          ...state,
          openPath: [...state.openPath, msg.value],
          highlights: setHighlight(state.highlights, msg.value, firstNav(parent.children)),
        },
        [],
      ]
    }
    case 'closeSub': {
      if (state.openPath.length === 0) return [state, []]
      const deepest = state.openPath[state.openPath.length - 1]!
      const highlights = { ...state.highlights }
      delete highlights[deepest]
      return [{ ...state, openPath: state.openPath.slice(0, -1), highlights }, []]
    }
    case 'selectHighlighted': {
      const value = state.highlights[msg.level] ?? null
      if (value === null) return [state, []]
      return applySelect(state, value)
    }
    case 'select':
      return applySelect(state, msg.value)
    case 'setItems':
      return [{ ...state, items: msg.items }, []]
    case 'typeahead': {
      if (!state.open) return [state, []]
      const nav = navigable(levelItems(state.items, msg.level))
      const acc = typeaheadAccumulate(state.typeahead, msg.char, msg.now, state.typeaheadExpiresAt)
      const current = state.highlights[msg.level] ?? null
      const startIdx = current ? nav.indexOf(current) : null
      const mask = nav.map(() => false)
      const matchIdx = typeaheadMatch(nav, mask, acc, startIdx)
      const match = matchIdx === null ? null : nav[matchIdx]!
      return [
        {
          ...state,
          typeahead: acc,
          typeaheadExpiresAt: msg.now + TYPEAHEAD_TIMEOUT_MS,
          highlights: setHighlight(state.highlights, msg.level, match ?? current),
        },
        [],
      ]
    }
    case 'setDir':
      return [{ ...state, dir: msg.dir }, []]
    case 'animationEnd': {
      const [next] = presence.update(
        { status: state.status, unmountOnExit: true },
        { type: 'animationEnd' },
      )
      if (next.status === state.status) return [state, []]
      return [{ ...state, status: next.status }, []]
    }
  }
}

// ---- connect: shared part builders ----

/** The shared attribute bag for an action / checkbox / radio item, scoped. */
export interface MenuItemAttrs<Scope extends string> {
  role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'
  id: string
  'aria-disabled': Signal<'true' | undefined>
  'aria-checked'?: Signal<'true' | 'false'>
  'data-state': Signal<'highlighted' | undefined>
  'data-disabled': Signal<'' | undefined>
  'data-scope': Scope
  'data-part': 'item'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerMove: (e: PointerEvent) => void
}

export interface MenuItemPartsOf<Scope extends string> {
  item: MenuItemAttrs<Scope> & { role: 'menuitem' }
}

export interface MenuCheckItemPartsOf<Scope extends string> {
  item: MenuItemAttrs<Scope> & {
    role: 'menuitemcheckbox' | 'menuitemradio'
    'aria-checked': Signal<'true' | 'false'>
  }
}

export interface MenuGroupPartsOf<Scope extends string> {
  group: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': Scope
    'data-part': 'group'
  }
  label: {
    id: string
    'data-scope': Scope
    'data-part': 'group-label'
  }
}

export interface MenuSeparatorPartsOf<Scope extends string> {
  role: 'separator'
  'data-scope': Scope
  'data-part': 'separator'
}

export interface MenuSubTriggerPartsOf<Scope extends string> {
  role: 'menuitem'
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': Signal<boolean>
  'aria-controls': string
  'aria-disabled': Signal<'true' | undefined>
  'data-state': Signal<'highlighted' | undefined>
  'data-scope': Scope
  'data-part': 'subtrigger'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface MenuSubPositionerPartsOf<Scope extends string> {
  'data-scope': Scope
  'data-part': 'subpositioner'
  style: string
}

export interface MenuSubContentPartsOf<Scope extends string> {
  role: 'menu'
  id: string
  'aria-labelledby': string
  'aria-activedescendant': Signal<string | undefined>
  tabindex: -1
  'data-state': Signal<'open' | 'closed'>
  'data-scope': Scope
  'data-part': 'subcontent'
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

/** Element-id builders for a menu-tree instance. */
export interface MenuTreeIds {
  itemId: (value: string) => string
  subContentId: (value: string) => string
  subTriggerId: (value: string) => string
  groupLabelId: (id: string) => string
}

export interface MenuTreePartsConfig<Scope extends string, S extends MenuTreeState> {
  scope: Scope
  state: Signal<S>
  send: Send<MenuTreeMsg>
  ids: MenuTreeIds
  onSelect?: (value: string) => void
  /** ms to wait before opening a submenu on hover (default: 200). */
  hoverDelay?: number
  /** ms to wait before closing a submenu after the pointer leaves (default: 300). */
  hoverCloseDelay?: number
}

/** The shared part builders + the root keydown handler (for the content part). */
export interface MenuTreeParts<Scope extends string> {
  item: (value: string) => MenuItemPartsOf<Scope>
  checkboxItem: (value: string) => MenuCheckItemPartsOf<Scope>
  radioItem: (value: string) => MenuCheckItemPartsOf<Scope>
  group: (id: string) => MenuGroupPartsOf<Scope>
  separator: () => MenuSeparatorPartsOf<Scope>
  subTrigger: (value: string) => MenuSubTriggerPartsOf<Scope>
  subPositioner: (value: string) => MenuSubPositionerPartsOf<Scope>
  subContent: (value: string) => MenuSubContentPartsOf<Scope>
  /** Root-level content keydown (highlight nav / typeahead / select / close). */
  rootKeyNav: (e: KeyboardEvent) => void
}

/**
 * Build the shared menu-tree part bag for a `connect()`, scoped by `scope`.
 * Owns the hover-intent submenu timers, the memoized value→level resolver, the
 * highlight-reference-stable pointer handlers, and the aria-activedescendant
 * wiring. The root trigger + content parts stay component-specific.
 */
export function createMenuTreeParts<Scope extends string, S extends MenuTreeState>(
  cfg: MenuTreePartsConfig<Scope, S>,
): MenuTreeParts<Scope> {
  const { scope, state, send, ids, onSelect } = cfg
  const hoverDelay = cfg.hoverDelay ?? 200
  const hoverCloseDelay = cfg.hoverCloseDelay ?? 300

  // Per-instance hover-intent timers keyed by subTrigger value.
  const openTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  const closeTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  const clearOpenTimer = (value: string): void => {
    const t = openTimers[value]
    if (t) {
      clearTimeout(t)
      delete openTimers[value]
    }
  }
  const clearCloseTimer = (value: string): void => {
    const t = closeTimers[value]
    if (t) {
      clearTimeout(t)
      delete closeTimers[value]
    }
  }
  const scheduleOpenSub = (value: string): void => {
    clearCloseTimer(value)
    clearOpenTimer(value)
    openTimers[value] = setTimeout(() => {
      delete openTimers[value]
      send({ type: 'openSub', value })
    }, hoverDelay)
  }
  const scheduleCloseSub = (value: string): void => {
    clearOpenTimer(value)
    clearCloseTimer(value)
    closeTimers[value] = setTimeout(() => {
      delete closeTimers[value]
      // `closeSub` pops the DEEPEST open submenu. Only fire it when THIS submenu
      // is the deepest open one — otherwise a shallower level's pointerleave
      // would wrongly collapse a deeper, still-hovered submenu.
      const openPath = state.peek()?.openPath ?? []
      if (openPath[openPath.length - 1] === value) send({ type: 'closeSub' })
    }, hoverCloseDelay)
  }

  // Resolve which level an item lives at. Used by pointer highlight (per mouse
  // tick), memoized per items-array reference: an O(n) tree walk becomes an
  // O(1) lookup, rebuilt only when `items` changes.
  let levelCacheItems: MenuNode[] | null = null
  let levelCache = new Map<string, string>()
  const levelOf = (value: string): string => {
    const items = state.peek()?.items ?? []
    if (items !== levelCacheItems) {
      levelCacheItems = items
      levelCache = new Map()
      const walk = (list: MenuNode[], level: string): void => {
        for (const it of list) {
          levelCache.set(it.value, level)
          if (it.children) walk(it.children, it.value)
        }
      }
      walk(items, '')
    }
    return levelCache.get(value) ?? ''
  }

  const highlightedState = (value: string): Signal<'highlighted' | undefined> =>
    state.map((s) => (Object.values(s.highlights).includes(value) ? 'highlighted' : undefined))

  const itemAttrs = (
    value: string,
    role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio',
  ): MenuItemAttrs<Scope> => ({
    role,
    id: ids.itemId(value),
    'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
    ...(role === 'menuitem'
      ? {}
      : {
          'aria-checked': state.map((s): 'true' | 'false' =>
            s.checked.includes(value) ? 'true' : 'false',
          ),
        }),
    'data-state': highlightedState(value),
    'data-disabled': state.map((s) => (isDisabled(s.items, value) ? '' : undefined)),
    'data-scope': scope,
    'data-part': 'item',
    'data-value': value,
    tabindex: -1,
    onClick: tagSend(send, ['select'], () => {
      send({ type: 'select', value })
      onSelect?.(value)
    }),
    onPointerMove: tagSend(send, ['highlight'], () => {
      const level = levelOf(value)
      if ((state.peek()?.highlights[level] ?? null) === value) return
      send({ type: 'highlight', level, value })
    }),
  })

  const rootKeyNav = tagSend(
    send,
    [
      'highlightNext',
      'highlightPrev',
      'highlightFirst',
      'highlightLast',
      'selectHighlighted',
      'close',
      'typeahead',
    ],
    (e: KeyboardEvent): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          send({ type: 'highlightNext', level: '' })
          return
        case 'ArrowUp':
          e.preventDefault()
          send({ type: 'highlightPrev', level: '' })
          return
        case 'Home':
          e.preventDefault()
          send({ type: 'highlightFirst', level: '' })
          return
        case 'End':
          e.preventDefault()
          send({ type: 'highlightLast', level: '' })
          return
        case 'Enter':
        case ' ':
          e.preventDefault()
          send({ type: 'selectHighlighted', level: '' })
          return
        case 'Escape':
          e.preventDefault()
          send({ type: 'close' })
          return
        default:
          if (isTypeaheadKey(e)) {
            send({ type: 'typeahead', level: '', char: e.key, now: Date.now() })
          }
      }
    },
  )

  return {
    item: (value: string): MenuItemPartsOf<Scope> => ({
      item: itemAttrs(value, 'menuitem') as MenuItemAttrs<Scope> & { role: 'menuitem' },
    }),
    checkboxItem: (value: string): MenuCheckItemPartsOf<Scope> => ({
      item: itemAttrs(value, 'menuitemcheckbox') as MenuItemAttrs<Scope> & {
        role: 'menuitemcheckbox'
        'aria-checked': Signal<'true' | 'false'>
      },
    }),
    radioItem: (value: string): MenuCheckItemPartsOf<Scope> => ({
      item: itemAttrs(value, 'menuitemradio') as MenuItemAttrs<Scope> & {
        role: 'menuitemradio'
        'aria-checked': Signal<'true' | 'false'>
      },
    }),
    group: (id: string): MenuGroupPartsOf<Scope> => ({
      group: {
        role: 'group',
        'aria-labelledby': ids.groupLabelId(id),
        'data-scope': scope,
        'data-part': 'group',
      },
      label: {
        id: ids.groupLabelId(id),
        'data-scope': scope,
        'data-part': 'group-label',
      },
    }),
    separator: (): MenuSeparatorPartsOf<Scope> => ({
      role: 'separator',
      'data-scope': scope,
      'data-part': 'separator',
    }),
    subTrigger: (value: string): MenuSubTriggerPartsOf<Scope> => ({
      role: 'menuitem',
      id: ids.subTriggerId(value),
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.openPath.includes(value)),
      'aria-controls': ids.subContentId(value),
      'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
      'data-state': highlightedState(value),
      'data-scope': scope,
      'data-part': 'subtrigger',
      'data-value': value,
      tabindex: -1,
      onClick: tagSend(send, ['openSub'], () => send({ type: 'openSub', value })),
      onPointerEnter: () => scheduleOpenSub(value),
      onPointerLeave: () => scheduleCloseSub(value),
      onKeyDown: tagSend(send, ['openSub', 'highlightNext', 'highlightPrev', 'close'], (e) => {
        const key = flipArrow(e.key, state.peek().dir)
        switch (key) {
          case 'ArrowRight':
          case 'Enter':
          case ' ':
            e.preventDefault()
            send({ type: 'openSub', value })
            return
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'highlightNext', level: levelOf(value) })
            return
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'highlightPrev', level: levelOf(value) })
            return
          case 'Escape':
            e.preventDefault()
            send({ type: 'close' })
            return
        }
      }),
    }),
    subPositioner: (_value: string): MenuSubPositionerPartsOf<Scope> => ({
      'data-scope': scope,
      'data-part': 'subpositioner',
      style: 'position:absolute;top:0;left:0;',
    }),
    subContent: (value: string): MenuSubContentPartsOf<Scope> => ({
      role: 'menu',
      id: ids.subContentId(value),
      'aria-labelledby': ids.subTriggerId(value),
      'aria-activedescendant': state.map((s) => {
        const v = s.highlights[value]
        return v == null ? undefined : ids.itemId(v)
      }),
      tabindex: -1,
      'data-state': state.map((s) => (s.openPath.includes(value) ? 'open' : 'closed')),
      'data-scope': scope,
      'data-part': 'subcontent',
      onPointerEnter: () => clearCloseTimer(value),
      onPointerLeave: () => scheduleCloseSub(value),
      onKeyDown: tagSend(
        send,
        [
          'highlightNext',
          'highlightPrev',
          'highlightFirst',
          'highlightLast',
          'selectHighlighted',
          'closeSub',
          'typeahead',
        ],
        (e: KeyboardEvent): void => {
          const key = flipArrow(e.key, state.peek().dir)
          switch (key) {
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'highlightNext', level: value })
              return
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'highlightPrev', level: value })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'highlightFirst', level: value })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'highlightLast', level: value })
              return
            case 'Enter':
            case ' ':
              e.preventDefault()
              send({ type: 'selectHighlighted', level: value })
              return
            case 'ArrowLeft':
            case 'Escape':
              e.preventDefault()
              send({ type: 'closeSub' })
              return
            default:
              if (isTypeaheadKey(e)) {
                send({ type: 'typeahead', level: value, char: e.key, now: Date.now() })
              }
          }
        },
      ),
    }),
    rootKeyNav,
  }
}
