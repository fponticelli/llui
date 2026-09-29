import type { Send, ReadSignal, Mountable, Renderable } from '@llui/dom'
import { tagSend } from '@llui/dom'
import {
  eventDirection,
  flipArrow,
  floatingDir,
  setDirection,
  syncDomDirection,
  type DirectionState,
  type TextDirection,
} from '../utils/direction.js'
import { type Placement } from '../utils/floating.js'
import { onScopeTeardown } from '../utils/lifecycle.js'
import { createOverlay, positionerProps } from '../utils/overlay-engine.js'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { presence, type PresenceStatus } from './presence.js'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'
import { deriveOnce, membershipSet } from '../utils/derive.js'
import { allFiniteNumbers } from '../utils/number.js'

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
export interface MenuTreeState extends DirectionState {
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
  /**
   * Reading direction, routed through the shared `@llui/interactions`
   * direction-sync seam (`../utils/direction.js`) rather than a second,
   * independently-maintained resolver — `dirSource` (from `DirectionState`)
   * tracks whether `dir` came from explicit config/`setDir` or from the
   * mounted root's live ancestor `dir` attribute (#265 finding 6). A menu
   * portals into `<body>`, and an EXPLICIT direction is AUTHORITATIVE over
   * the direction the floating element would otherwise compute to (#138
   * review, blocking 4) — `dirSource: 'explicit'` is what makes that
   * override stick instead of being overwritten by the next DOM observation.
   */
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
  | { type: 'setDir'; dir: TextDirection }
  /** @humanOnly — synchronized from the mounted root's live ancestor direction. */
  | { type: 'syncDomDir'; dir: TextDirection }
  | { type: 'animationEnd' }

// ---- presence lifecycle (composes presence.update; never reinvents it) ----

/** Advance the root content's presence status on an OPEN. The default
 * synchronous path lands on `open`; an animated menu stays at `opening` until
 * its content's real animation-end event resolves the shared presence machine. */
export function statusOnOpen(status: PresenceStatus, skipAnimations: boolean): PresenceStatus {
  const [next] = presence.update({ status, unmountOnExit: true }, { type: 'open' })
  return skipAnimations && next.status === 'opening' ? 'open' : next.status
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

/**
 * The root-first chain of values from the top of the tree down to `value`,
 * inclusive — i.e. the `openPath` under which `value`'s submenu is open.
 * `null` when `value` is not in the tree.
 *
 * `openPath` is a PATH, and every consumer reads it as one: `openValues` turns
 * it into a membership set driving `aria-expanded` on every subTrigger and
 * `data-state` on every subContent, `closeSub` POPS it, and the hover-close
 * guard compares against its LAST entry. Deriving the whole chain from the item
 * tree is what keeps that invariant total (#271): opening a sibling REPLACES
 * the branch open at that depth instead of nesting under it, and a request for
 * a value whose ancestors are not open opens them rather than producing an
 * array that is not a path at all. Truncating the existing array to the new
 * value's DEPTH is not equivalent — it is only correct while the new value's
 * parent already sits on the path, which nothing enforces.
 */
export function openPathTo(items: MenuNode[], value: string): string[] | null {
  const walk = (list: MenuNode[], trail: readonly string[]): string[] | null => {
    for (const it of list) {
      const next = [...trail, it.value]
      if (it.value === value) return next
      if (it.children) {
        const found = walk(it.children, next)
        if (found) return found
      }
    }
    return null
  }
  return walk(items, [])
}

/**
 * The longest PREFIX of `openPath` that is still a real chain of sub-menus in
 * `items`. Each step is matched against the DIRECT children of the level above
 * it — not `findItem`, which would keep a path whose value was re-parented
 * elsewhere in the tree and so is no longer a path at all.
 *
 * "Still a sub-menu" is the SAME predicate `openSub` opens on — a `children`
 * array is present — deliberately not "and it is non-empty". A submenu whose
 * children arrive later is filled by `setItems`, so closing it on an interim
 * `setItems` that still carries `children: []` would collapse exactly the
 * async case the message exists to serve.
 */
export function validOpenPrefix(items: MenuNode[], openPath: readonly string[]): string[] {
  const out: string[] = []
  let level = items
  for (const value of openPath) {
    const node = level.find((it) => it.value === value)
    if (!node || !node.children) break
    out.push(value)
    level = node.children
  }
  return out
}

/** Whether two open-paths name the same chain. */
function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
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

/**
 * `highlights` after an item-tree swap. Two repairs, because after `setItems`
 * BOTH halves of a highlight entry can be stale: the LEVEL it is keyed on (the
 * branch may be gone — pruned against the surviving `openPath`) and the VALUE
 * it names (the item may be gone, or may have become a separator or disabled).
 *
 * An orphaned value is set to `null`, not re-pointed at the level's first item:
 * the item the user was on has gone, and inventing a new virtual-focus target
 * moves the user somewhere they never navigated to. `null` is a state
 * `highlight` already models, `aria-activedescendant` then reports nothing, and
 * the next ArrowDown lands on the first navigable item because `nextNav` reads
 * a `null` cursor as "before the start".
 *
 * A value that merely became DISABLED is dropped for the same reason the
 * `highlight` reducer refuses to move onto a disabled item — keeping it would
 * leave `aria-activedescendant` and `data-highlighted` on something the machine
 * would not let the user select.
 *
 * Returns the SAME reference when nothing changed, so an unrelated `setItems`
 * does not dirty the `highlights` path for the reconciler.
 */
function repairHighlights(
  items: MenuNode[],
  openPath: readonly string[],
  previousPath: readonly string[],
  highlights: Record<string, string | null>,
): Record<string, string | null> {
  const keep = new Set(openPath)
  const closed = previousPath.filter((v) => !keep.has(v) && v in highlights)
  const orphaned = ['', ...openPath].filter((level) => {
    const value = highlights[level] ?? null
    return value !== null && !navigable(levelItems(items, level)).includes(value)
  })
  if (closed.length === 0 && orphaned.length === 0) return highlights
  const next = { ...highlights }
  for (const v of closed) delete next[v]
  for (const level of orphaned) next[level] = null
  return next
}

/**
 * Open `value`'s submenu, REPLACING whatever branch is open beside it rather
 * than nesting under it (#271). Shared by `openSub` and by `applySelect`'s
 * parent branch, which were two copies of the same append.
 *
 * Highlights are pruned for every level the truncation closes, mirroring what
 * `closeSub` already does for the one level it pops — otherwise `highlights`
 * accumulates an entry per closed level in state the machine claims to own. The
 * newly opened level is highlighted at its first navigable child; a level that
 * was ALREADY open keeps its highlight, so re-opening an ancestor collapses the
 * deeper branch without also losing the user's place at that level.
 */
function openSubmenu<S extends MenuTreeState>(
  state: S,
  value: string,
  children: MenuNode[],
): [S, never[]] {
  const openPath = openPathTo(state.items, value)
  if (openPath === null) return [state, []]
  // Already exactly this chain: return the SAME reference so the reconciler
  // skips the commit, and leave the level's highlight where the user left it.
  if (samePath(state.openPath, openPath)) return [state, []]

  const keep = new Set(openPath)
  let highlights = state.highlights
  const dropped = state.openPath.filter((v) => !keep.has(v))
  if (dropped.length > 0) {
    highlights = { ...highlights }
    for (const v of dropped) delete highlights[v]
  }
  if (!state.openPath.includes(value)) {
    highlights = setHighlight(highlights, value, firstNav(children))
  }
  return [{ ...state, openPath, highlights }, []]
}

/** Shared selection logic for `select` and `selectHighlighted`. */
function applySelect<S extends MenuTreeState>(state: S, value: string): [S, never[]] {
  const item = findItem(state.items, value)
  if (!item || item.disabled || item.kind === 'separator') return [state, []]

  // A parent with children opens its submenu rather than selecting.
  if (item.children && item.children.length > 0) {
    return openSubmenu(state, value, item.children)
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

/** The deepest open submenu level (its subTrigger value), or `''` for the root. */
export function deepestMenuLevel(state: Pick<MenuTreeState, 'openPath'>): string {
  return state.openPath.length > 0 ? state.openPath[state.openPath.length - 1]! : ''
}

/**
 * The value highlighted at the deepest open submenu level — what a virtual-focus
 * root `content` should announce via `aria-activedescendant`. When no submenu is
 * open this is the root-level highlight, so the root case is unchanged.
 */
export function activeMenuHighlight(
  state: Pick<MenuTreeState, 'openPath' | 'highlights'>,
): string | null {
  return state.highlights[deepestMenuLevel(state)] ?? null
}

/**
 * Reduce a message shared by every menu-tree component, preserving any extra
 * component state fields (e.g. context-menu's x/y). Returns the SAME state
 * reference on a no-op so the reconciler can skip the commit.
 */
export function reduceMenuTree<S extends MenuTreeState>(state: S, msg: MenuTreeMsg): [S, never[]] {
  if (!allFiniteNumbers(msg)) return [state, []]
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
      return openSubmenu(state, msg.value, parent.children)
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
    case 'setItems': {
      // `openPath` and `highlights` both name values in the OLD tree, and both
      // go stale here. Left alone, a branch the new items no longer contain
      // stays "open": `deepestMenuLevel` keeps naming it, so `levelItems`
      // answers [] and every arrow key is inert while Escape pops a submenu
      // nothing is rendering instead of closing the menu. Same class as #271 —
      // the array stops being a path — reached by a different route, so it is
      // truncated to the part that still is one, and the highlights are
      // repaired against the tree that actually arrived.
      const openPath = validOpenPrefix(msg.items, state.openPath)
      const highlights = repairHighlights(msg.items, openPath, state.openPath, state.highlights)
      if (openPath.length === state.openPath.length && highlights === state.highlights) {
        return [{ ...state, items: msg.items }, []]
      }
      return [{ ...state, items: msg.items, openPath, highlights }, []]
    }
    case 'typeahead': {
      if (!state.open) return [state, []]
      const typeaheadExpiresAt = msg.now + TYPEAHEAD_TIMEOUT_MS
      if (!Number.isFinite(typeaheadExpiresAt)) return [state, []]
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
          typeaheadExpiresAt,
          highlights: setHighlight(state.highlights, msg.level, match ?? current),
        },
        [],
      ]
    }
    case 'setDir':
      return [setDirection(state, msg.dir), []]
    case 'syncDomDir':
      return [syncDomDirection(state, msg.dir), []]
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
  'aria-disabled': ReadSignal<'true' | undefined>
  'aria-checked'?: ReadSignal<'true' | 'false'>
  /** Bare presence flag, matching `select` / `combobox` / `listbox` and the
   * baseline stylesheet. NOT `data-state="highlighted"`: `data-state` on this
   * machine means open/closed (trigger, content), and spelling the highlight as
   * an enum value of it matched nothing anyone styles. */
  'data-highlighted': ReadSignal<'' | undefined>
  'data-disabled': ReadSignal<'' | undefined>
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
    'aria-checked': ReadSignal<'true' | 'false'>
  }
}

export interface MenuGroupPartsOf<Scope extends string> {
  group: {
    role: 'group'
    /** The label part's id, or absent when `hasLabel: false`. */
    'aria-labelledby': string | undefined
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
  'aria-expanded': ReadSignal<boolean>
  'aria-controls': string
  'aria-disabled': ReadSignal<'true' | undefined>
  /** Bare presence flag, matching `select` / `combobox` / `listbox` and the
   * baseline stylesheet. NOT `data-state="highlighted"`: `data-state` on this
   * machine means open/closed (trigger, content), and spelling the highlight as
   * an enum value of it matched nothing anyone styles. */
  'data-highlighted': ReadSignal<'' | undefined>
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
  'aria-activedescendant': ReadSignal<string | undefined>
  tabindex: -1
  'data-state': ReadSignal<'open' | 'closed'>
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
  state: ReadSignal<S>
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
  /**
   * A labelled group's parts. The group names its `label` part through
   * `aria-labelledby`; a consumer that renders the group WITHOUT that label
   * passes `{ hasLabel: false }` so it never names an element that does not
   * exist (an unlabelled `role="group"` is valid; a broken idref is not — the
   * `dialog` `hasDescription` rule, #268). Default: true.
   */
  group: (id: string, options?: { readonly hasLabel?: boolean }) => MenuGroupPartsOf<Scope>
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
  // A pending hover timer must not act once the menu unmounts, or it dispatches
  // into a disposed handle (#123). Capture the subtrigger at SCHEDULE time and
  // drop the message if it was live then but is detached when the timer fires.
  // `ids.subTriggerId` is instance-scoped, so this resolves THIS menu even with
  // several on the page. (No element at all — a unit test that renders nothing —
  // means no guard, exactly as in tooltip/hover-card.)
  //
  //
  // The guard is the CORRECTNESS half. The tidy-up half — cancelling the timer
  // outright — is `onScopeTeardown` below: `connect()` must stay callable from a
  // unit test with no build context, so it hooks the scope only when there is
  // one to hook, and the guard covers the rest.
  const detached = (el: Element | null): boolean => el !== null && !el.isConnected
  const subTriggerEl = (value: string): Element | null =>
    typeof document === 'undefined' ? null : document.getElementById(ids.subTriggerId(value))

  onScopeTeardown(() => {
    for (const value of Object.keys(openTimers)) clearOpenTimer(value)
    for (const value of Object.keys(closeTimers)) clearCloseTimer(value)
  })

  const scheduleOpenSub = (value: string): void => {
    clearCloseTimer(value)
    clearOpenTimer(value)
    const trigger = subTriggerEl(value)
    openTimers[value] = setTimeout(() => {
      delete openTimers[value]
      if (detached(trigger)) return
      send({ type: 'openSub', value })
    }, hoverDelay)
  }
  const scheduleCloseSub = (value: string): void => {
    clearOpenTimer(value)
    clearCloseTimer(value)
    const trigger = subTriggerEl(value)
    closeTimers[value] = setTimeout(() => {
      delete closeTimers[value]
      if (detached(trigger)) return
      // `closeSub` pops the DEEPEST open submenu. Only fire it when THIS submenu
      // is the deepest open one — otherwise a shallower level's pointerleave
      // would wrongly collapse a deeper, still-hovered submenu.
      const openPath = state.peek()?.openPath ?? []
      if (openPath[openPath.length - 1] === value) send({ type: 'closeSub' })
    }, hoverCloseDelay)
  }

  // One walk of the item tree per `items` identity, answering the two questions
  // the per-item props ask. Both used to be asked PER ITEM: `isDisabled` walked
  // the whole tree for every item, and the level lookup did the same for every
  // pointer tick (#124) — a per-item walk over N items, i.e. quadratic in the
  // menu size. The exact figure depends on what you count, so the test
  // (`per-item-lookup.test.ts`) counts the one thing that is unambiguous:
  // `disabled` PROPERTY READS, measured at 200 before and 100 after on a
  // 100-item menu. That 2N is two per-item bindings (`aria-disabled` and
  // `data-disabled`) each calling `isDisabled` once per item, NOT the node
  // visits the walk itself makes.
  const levelIndex = deriveOnce((items: MenuNode[]): ReadonlyMap<string, string> => {
    const levels = new Map<string, string>()
    const walk = (list: MenuNode[], level: string): void => {
      for (const it of list) {
        levels.set(it.value, level)
        if (it.children) walk(it.children, it.value)
      }
    }
    walk(items, '')
    return levels
  })
  const disabledValues = deriveOnce((items: MenuNode[]): ReadonlySet<string> => {
    const out = new Set<string>()
    const walk = (list: MenuNode[]): void => {
      for (const it of list) {
        if (it.disabled) out.add(it.value)
        if (it.children) walk(it.children)
      }
    }
    walk(items)
    return out
  })
  const checkedValues = membershipSet<string>()
  const openValues = membershipSet<string>()
  // `highlights` is one entry per open level, so the VALUES are the highlighted
  // items — derived once instead of `Object.values(...)` allocating per item.
  const highlightedValues = deriveOnce(
    (highlights: Record<string, string | null>): ReadonlySet<string | null> =>
      new Set(Object.values(highlights)),
  )

  // Resolve which level an item lives at. Used by pointer highlight (per mouse
  // tick): an O(n) tree walk becomes an O(1) lookup.
  const levelOf = (value: string): string => {
    const items = state.peek()?.items
    if (items === undefined) return ''
    return levelIndex(items).get(value) ?? ''
  }

  const highlightedState = (value: string): ReadSignal<'' | undefined> =>
    state.map((s) => (highlightedValues(s.highlights).has(value) ? '' : undefined))

  const itemAttrs = (
    value: string,
    role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio',
  ): MenuItemAttrs<Scope> => ({
    role,
    id: ids.itemId(value),
    'aria-disabled': state.map((s) => (disabledValues(s.items).has(value) ? 'true' : undefined)),
    ...(role === 'menuitem'
      ? {}
      : {
          'aria-checked': state.map((s): 'true' | 'false' =>
            checkedValues(s.checked).has(value) ? 'true' : 'false',
          ),
        }),
    'data-highlighted': highlightedState(value),
    'data-disabled': state.map((s) => (disabledValues(s.items).has(value) ? '' : undefined)),
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
      'openSub',
      'closeSub',
      'close',
      'typeahead',
    ],
    (e: KeyboardEvent): void => {
      // Virtual (aria-activedescendant) focus keeps DOM focus on the root
      // content, so ONLY this handler ever fires — even when a submenu is
      // open. Route every navigation key to the DEEPEST open submenu level
      // (its subTrigger value) so arrow/typeahead/select act inside the open
      // submenu; the subTrigger/subContent handlers never receive DOM focus.
      const s = state.peek()
      const openPath = s?.openPath ?? []
      const level = openPath.length > 0 ? openPath[openPath.length - 1]! : ''
      const highlighted = s?.highlights[level] ?? null
      const isSubTrigger = (value: string | null): boolean => {
        if (value === null || s === undefined) return false
        const item = findItem(s.items, value)
        return item != null && !item.disabled && !!item.children && item.children.length > 0
      }
      // Resolved at event time (`eventDirection`) so a same-tick ancestor `dir`
      // change is read correctly even before any `syncDomDir` message lands —
      // the same reason `navigation-menu.ts` resolves it here instead of off a
      // bare `s.dir` (#265 finding 6).
      const key = flipArrow(
        e.key,
        s === undefined ? null : eventDirection(s, e.currentTarget as Element | null),
      )
      switch (key) {
        case 'ArrowDown':
          e.preventDefault()
          send({ type: 'highlightNext', level })
          return
        case 'ArrowUp':
          e.preventDefault()
          send({ type: 'highlightPrev', level })
          return
        case 'Home':
          e.preventDefault()
          send({ type: 'highlightFirst', level })
          return
        case 'End':
          e.preventDefault()
          send({ type: 'highlightLast', level })
          return
        case 'ArrowRight':
          // Open/enter the submenu when the deepest-level highlight is a
          // subtrigger; otherwise ArrowRight is a no-op on a leaf item.
          if (isSubTrigger(highlighted)) {
            e.preventDefault()
            send({ type: 'openSub', value: highlighted! })
          }
          return
        case 'ArrowLeft':
          // Close the deepest open submenu, stepping back toward the root.
          if (openPath.length > 0) {
            e.preventDefault()
            send({ type: 'closeSub' })
          }
          return
        case 'Enter':
        case ' ':
          // selectHighlighted opens a highlighted subtrigger (via applySelect)
          // and selects a leaf — one message covers both.
          e.preventDefault()
          send({ type: 'selectHighlighted', level })
          return
        case 'Escape':
          e.preventDefault()
          // Escape closes the deepest submenu first, then the whole menu.
          send(openPath.length > 0 ? { type: 'closeSub' } : { type: 'close' })
          return
        default:
          if (isTypeaheadKey(e)) {
            send({ type: 'typeahead', level, char: e.key, now: Date.now() })
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
        'aria-checked': ReadSignal<'true' | 'false'>
      },
    }),
    radioItem: (value: string): MenuCheckItemPartsOf<Scope> => ({
      item: itemAttrs(value, 'menuitemradio') as MenuItemAttrs<Scope> & {
        role: 'menuitemradio'
        'aria-checked': ReadSignal<'true' | 'false'>
      },
    }),
    group: (id: string, options = {}): MenuGroupPartsOf<Scope> => ({
      group: {
        role: 'group',
        'aria-labelledby': options.hasLabel === false ? undefined : ids.groupLabelId(id),
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
      'aria-expanded': state.map((s) => openValues(s.openPath).has(value)),
      'aria-controls': ids.subContentId(value),
      'aria-disabled': state.map((s) => (disabledValues(s.items).has(value) ? 'true' : undefined)),
      'data-highlighted': highlightedState(value),
      'data-scope': scope,
      'data-part': 'subtrigger',
      'data-value': value,
      tabindex: -1,
      onClick: tagSend(send, ['openSub'], () => send({ type: 'openSub', value })),
      onPointerEnter: () => scheduleOpenSub(value),
      onPointerLeave: () => scheduleCloseSub(value),
      onKeyDown: tagSend(send, ['openSub', 'highlightNext', 'highlightPrev', 'close'], (e) => {
        const key = flipArrow(
          e.key,
          eventDirection(state.peek(), e.currentTarget as Element | null),
        )
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
      'data-state': state.map((s) => (openValues(s.openPath).has(value) ? 'open' : 'closed')),
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
          const key = flipArrow(
            e.key,
            eventDirection(state.peek(), e.currentTarget as Element | null),
          )
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

// ---- engine-owned per-level submenu overlays (#265 A4) ----
//
// Each submenu level is its own `createOverlay` instance — SINGLE-phase (no
// `visibleWhen`: a submenu level is a synchronous boolean machine, exactly
// like select/combobox, so mount and floating attach/detach happen together)
// with an explicit
// `nestedLayerOwner` naming its own subTrigger, which is what keeps #171's fix
// (a modal opened over an open menu leaves it inert) working per LEVEL rather
// than per root menu.

export interface SubOverlayOptions<Scope extends string, S> {
  /** The subTrigger value this level opens under. */
  value: string
  state: ReadSignal<S>
  /** The subTrigger/subPositioner/subContent part builders for this scope
   * (from `parts` as returned by `createMenuTreeParts`/`connect()`). */
  parts: Pick<MenuTreeParts<Scope>, 'subTrigger' | 'subPositioner' | 'subContent'>
  /** The submenu's own content — typically a nested recursive render of
   * `it.children`, wrapped in `div({ ...parts.subContent(value) }, […])`
   * (`contentId` below must match that div's id, i.e. `parts.subContent(value).id`). */
  content: () => Renderable
  /** Whether this level should be mounted, given the FULL state `s` passed to
   * `state`. For `menu`/`context-menu`, `s.openPath.includes(value)`; for
   * `menubar`, `s` is the root `MenubarState` and this reaches into the one
   * embedded menu's `openPath`. */
  isOpen: (s: S) => boolean
  /** The direction-relevant slice of state for this level's placement, given
   * the full state `s` — `s` itself for `menu`/`context-menu`, the embedded
   * menu's state for `menubar`. */
  direction: (s: S) => Pick<MenuTreeState, 'dir' | 'dirSource'>
  /** Portal host (default: `body`, matching every other overlay in this file). */
  target?: string | HTMLElement
  positionerClass?: string
  /** Cross-axis alignment against the subTrigger (default: 'start' — the top
   * edge of the trigger, matching every other overlay's `*-start` default). */
  align?: 'start' | 'end'
  /** Gap between the subTrigger and its submenu, in px (default: 2, closing the
   * visible seam a hovering pointer would otherwise have to cross). */
  offset?: number
  /** Flip to the opposite side when there isn't room (default: true). */
  flip?: boolean
  /** Shift along the cross axis to stay in view (default: true). */
  shift?: boolean
}

/**
 * The physical placement for a submenu opening off its subTrigger: away from
 * the reading-direction inline-start edge, i.e. to the right under 'ltr' and
 * to the left under 'rtl' — the one call site that turns reading direction
 * into a physical side for this primitive (direction ITSELF is resolved by
 * the shared `eventDirection`/`resolveDir` seam, never re-derived here).
 */
function submenuPlacement(dir: TextDirection, align: 'start' | 'end'): Placement {
  const side = dir === 'rtl' ? 'left' : 'right'
  return `${side}-${align}` as Placement
}

/**
 * Build a per-level submenu overlay, anchored on its own subTrigger.
 *
 * Direction is resolved through `eventDirection(direction(state.peek()), trigger)`
 * — the SAME shared seam every keyboard handler in this file resolves through
 * (#265 finding 6), not an isolated `resolveDir` call: while `dirSource` is
 * `'dom'` it falls through to `resolveDir(trigger)`, so a submenu nested under
 * an RTL ancestor still opens the correct way even if the root menu itself is
 * LTR; once a consumer EXPLICITLY configures/`setDir`s a direction, that
 * explicit value wins here too. The placement is a THUNK
 * (`OverlayFloatingConfig.placement`), resolved fresh at attach time. `dir`
 * passes only an EXPLICIT direction (`floatingDir`), exactly like the root
 * `overlay()`s: while direction is automatic the engine resolves it from this
 * level's anchor (the subTrigger, inside the parent level's portaled subtree)
 * and writes it on the level's floating element (#265 finding 6).
 *
 * A runtime direction change WHILE a level stays open cannot be picked up by
 * `attachFloating`'s own `autoUpdate` — a physical `placement` string
 * (`'right-start'`) is resolved once at attach and a repeated
 * `computePosition` pass with the SAME closed-over string can never flip
 * sides. A DOM change (an ancestor `dir`) re-attaches through the engine's own
 * anchor-direction watch. A STATE change the DOM does not show (an explicit
 * `setDir`) re-attaches through `floating.reattachKey`: the positioner this
 * function builds carries `data-llui-reattach-key` bound to
 * `${dir}:${dirSource}`, and the engine re-runs the whole attach whenever that
 * attribute's value changes while mounted.
 *
 * No `dismiss` config: Escape and outside-click stay owned by the ROOT
 * overlay's dismissable layer plus this file's own subContent/subTrigger key
 * handlers (`ArrowLeft`/`Escape` -> `closeSub`). This level still registers as
 * a NESTED LAYER (owner: its own subTrigger) with the `outside` aspect, which
 * is what keeps a click inside it from being misread as "outside" the root
 * content (and, transitively, "outside" an ancestor level's own registration)
 * — see `nested-layer.ts`'s per-layer, per-aspect design.
 */
export function subOverlay<Scope extends string, S>(opts: SubOverlayOptions<Scope, S>): Mountable {
  const { value, state, parts } = opts
  const align = opts.align ?? 'start'
  const triggerId = parts.subTrigger(value).id
  const contentId = parts.subContent(value).id

  const directionKey = (s: S): string => {
    const d = opts.direction(s)
    return `${d.dir}:${d.dirSource}`
  }
  const resolvedDir = (): TextDirection => {
    const trigger = typeof document === 'undefined' ? null : document.getElementById(triggerId)
    return eventDirection(opts.direction(state.peek()), trigger)
  }

  return createOverlay({
    state,
    host: resolvePortalTarget(opts.target ?? 'body'),
    // The reactive `data-llui-reattach-key` marker lives HERE, on the
    // positioner wrapper `createOverlay` builds around `content()` — not as
    // an extra child inside content, which this file does not control (the
    // caller builds the `contentId`'d div itself). The engine finds it via
    // `content.closest(...)` (ancestor-or-self), which reaches this wrapper.
    positioner: positionerProps(
      { ...parts.subPositioner(value), 'data-llui-reattach-key': state.map(directionKey) },
      opts.positionerClass,
    ),
    content: opts.content,
    contentId,
    relationships: {
      placementAnchor: { id: triggerId },
      nestedLayerOwner: { id: triggerId },
      dismissIgnore: [{ id: triggerId }],
    },
    mountWhen: (s) => opts.isOpen(s),
    // No `dismiss` config — see the doc comment above.
    onDismiss: () => {},
    floating: {
      placement: () => submenuPlacement(resolvedDir(), align),
      offset: opts.offset ?? 2,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
      dir: () => floatingDir(opts.direction(state.peek())),
      reattachKey: () => directionKey(state.peek()),
    },
  })
}
