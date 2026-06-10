import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable.js'
import { attachFloating, type Placement } from '../utils/floating.js'
import { flipArrow } from '../utils/direction.js'
import { presence, type PresenceStatus } from './presence.js'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

/**
 * Menu — a dropdown of items triggered by a button. Supports submenus,
 * checkbox/radio items, groups, and separators. Keyboard navigation (arrows,
 * Home, End), typeahead (first-letter matching) scoped per open level,
 * Enter/Space to activate, Escape to unwind one level at a time.
 *
 * Items form a JSON-serializable tree. Each item has an opaque `value` (key);
 * the user's view renders the label/icon. `value`s must be unique across the
 * whole tree — they double as level keys and element ids. The machine tracks
 * the highlighted value PER LEVEL (`highlights`), the chain of open submenus
 * (`openPath`), and which checkbox/radio values are `checked`.
 */

/** Kind of a menu item. */
export type MenuItemKind = 'action' | 'checkbox' | 'radio' | 'separator'

/** A single node in the menu item tree (JSON-serializable). */
export interface MenuItem {
  value: string
  kind: MenuItemKind
  /** Radio group key (radio items in the same group are mutually exclusive). */
  group?: string
  /** Child items — present on a parent that opens a submenu. */
  children?: MenuItem[]
  disabled?: boolean
}

export interface MenuState {
  open: boolean
  /**
   * Presence lifecycle of the root content, layered over `open` for exit
   * animations. `open` stays the logical "should be visible/interactive" flag;
   * `status` tracks 'opening'/'open'/'closing'/'closed' so the content can stay
   * mounted while its exit animation runs (status 'closing'). When
   * `skipAnimations` is true (the default) a close jumps straight to 'closed'.
   */
  status: PresenceStatus
  /** When true (default), a close goes straight to 'closed' synchronously — no
   * exit animation, no waiting for an `animationEnd` that may never fire. */
  skipAnimations: boolean
  items: MenuItem[]
  /** Highlighted value per open level. Key `''` is the root; otherwise the parent subTrigger value. */
  highlights: Record<string, string | null>
  /** Chain of subTrigger values whose submenus are open (deepest last). */
  openPath: string[]
  /** Checked checkbox / radio values. */
  checked: string[]
  /** When true, selecting a checkbox/radio also closes the menu (default false). */
  closeOnSelect: boolean
  /** Accumulator for typeahead search (scoped to the deepest matching level). */
  typeahead: string
  typeaheadExpiresAt: number
  /** Reading direction. Under 'rtl', ArrowLeft/ArrowRight swap meaning. */
  dir: 'ltr' | 'rtl'
}

export type MenuMsg =
  /** @intent("Open the menu") */
  | { type: 'open' }
  /** @intent("Close the menu") */
  | { type: 'close' }
  /** @intent("Toggle the menu open/closed") */
  | { type: 'toggle' }
  /** @humanOnly */
  | { type: 'highlight'; level: string; value: string | null }
  /** @humanOnly */
  | { type: 'highlightNext'; level: string }
  /** @humanOnly */
  | { type: 'highlightPrev'; level: string }
  /** @humanOnly */
  | { type: 'highlightFirst'; level: string }
  /** @humanOnly */
  | { type: 'highlightLast'; level: string }
  /** @intent("Activate the currently-highlighted item at the given level") */
  | { type: 'selectHighlighted'; level: string }
  /** @intent("Activate the menu item with the given value") */
  | { type: 'select'; value: string }
  /** @intent("Open the submenu for the given parent item") */
  | { type: 'openSub'; value: string }
  /** @intent("Close the deepest open submenu") */
  | { type: 'closeSub' }
  /** @humanOnly */
  | { type: 'setItems'; items: MenuItem[] }
  /** @humanOnly */
  | { type: 'typeahead'; level: string; char: string; now: number }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }
  /** @humanOnly */
  | { type: 'animationEnd' }

export interface MenuInit {
  open?: boolean
  items?: MenuItem[]
  highlighted?: string | null
  checked?: string[]
  closeOnSelect?: boolean
  dir?: 'ltr' | 'rtl'
  /** When false, closing the menu plays an exit animation and the content stays
   * mounted (status 'closing') until an `animationEnd`. Default true: instant. */
  skipAnimations?: boolean
}

export function init(opts: MenuInit = {}): MenuState {
  const open = opts.open ?? false
  return {
    open,
    status: open ? 'open' : 'closed',
    skipAnimations: opts.skipAnimations ?? true,
    items: opts.items ?? [],
    highlights: { '': opts.highlighted ?? null },
    openPath: [],
    checked: opts.checked ?? [],
    closeOnSelect: opts.closeOnSelect ?? false,
    typeahead: '',
    typeaheadExpiresAt: 0,
    dir: opts.dir ?? 'ltr',
  }
}

// ---- presence lifecycle (composes presence.update; never reinvents it) ----

/** Advance the root content's presence status on an OPEN. Reuses presence's
 * reducer; with skipAnimations we land directly on 'open'. */
function statusOnOpen(status: PresenceStatus): PresenceStatus {
  const [next] = presence.update({ status, unmountOnExit: true }, { type: 'open' })
  // No enter animation is wired for menus today, so opening resolves immediately.
  return next.status === 'opening' ? 'open' : next.status
}

/** Advance the root content's presence status on a CLOSE REQUEST. With
 * skipAnimations the node unmounts synchronously ('closed'); otherwise it
 * enters 'closing' and stays mounted until `animationEnd`. */
function statusOnClose(status: PresenceStatus, skipAnimations: boolean): PresenceStatus {
  if (skipAnimations) return 'closed'
  const [next] = presence.update({ status, unmountOnExit: true }, { type: 'close' })
  return next.status
}

/** Whether the root menu content should be in the DOM. True for every status
 * except 'closed' — so the content stays mounted through the exit animation. */
export function isPresent(state: MenuState): boolean {
  return presence.isMounted({ status: state.status, unmountOnExit: true })
}

/** Alias of {@link isPresent} for parity with the presence-convention naming. */
export const isMounted = isPresent

// ---- item-tree helpers (pure) ----

/** Find an item by value anywhere in the tree, returning it (or null). */
function findItem(items: MenuItem[], value: string): MenuItem | null {
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
function levelItems(items: MenuItem[], level: string): MenuItem[] {
  if (level === '') return items
  const parent = findItem(items, level)
  return parent?.children ?? []
}

/** Navigable values at a level: skip separators and disabled items. */
function navigable(items: MenuItem[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.kind === 'separator') continue
    if (it.disabled) continue
    out.push(it.value)
  }
  return out
}

function firstNav(items: MenuItem[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[0]! : null
}

function lastNav(items: MenuItem[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[nav.length - 1]! : null
}

function nextNav(items: MenuItem[], from: string | null, delta: 1 | -1): string | null {
  const nav = navigable(items)
  if (nav.length === 0) return null
  const start = from === null ? -1 : nav.indexOf(from)
  const n = nav.length
  const idx = start === -1 && delta === 1 ? 0 : (((start + delta) % n) + n) % n
  return nav[idx]!
}

function isDisabled(items: MenuItem[], value: string): boolean {
  const it = findItem(items, value)
  return !!it?.disabled
}

function setHighlight(
  highlights: Record<string, string | null>,
  level: string,
  value: string | null,
): Record<string, string | null> {
  return { ...highlights, [level]: value }
}

/** Toggle a checkbox value. */
function toggleChecked(checked: string[], value: string): string[] {
  return checked.includes(value) ? checked.filter((v) => v !== value) : [...checked, value]
}

/** Select a radio value: clear other members of its group, set this one. */
function selectRadio(items: MenuItem[], checked: string[], item: MenuItem): string[] {
  const group = item.group
  const siblings = group ? collectGroupValues(items, group) : [item.value]
  return [...checked.filter((v) => !siblings.includes(v)), item.value]
}

function collectGroupValues(items: MenuItem[], group: string): string[] {
  const out: string[] = []
  const walk = (list: MenuItem[]): void => {
    for (const it of list) {
      if (it.kind === 'radio' && it.group === group) out.push(it.value)
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return out
}

export function update(state: MenuState, msg: MenuMsg): [MenuState, never[]] {
  switch (msg.type) {
    case 'open': {
      const highlighted = state.highlights[''] ?? firstNav(state.items)
      return [
        {
          ...state,
          open: true,
          status: statusOnOpen(state.status),
          highlights: setHighlight(state.highlights, '', highlighted),
        },
        [],
      ]
    }
    case 'close':
      return [
        {
          ...state,
          open: false,
          status: statusOnClose(state.status, state.skipAnimations),
          highlights: { '': null },
          openPath: [],
          typeahead: '',
        },
        [],
      ]
    case 'toggle':
      if (state.open) {
        return [
          {
            ...state,
            open: false,
            status: statusOnClose(state.status, state.skipAnimations),
            highlights: { '': null },
            openPath: [],
            typeahead: '',
          },
          [],
        ]
      }
      return [
        {
          ...state,
          open: true,
          status: statusOnOpen(state.status),
          highlights: setHighlight(
            state.highlights,
            '',
            state.highlights[''] ?? firstNav(state.items),
          ),
        },
        [],
      ]
    case 'highlight':
      if (msg.value !== null && isDisabled(state.items, msg.value)) return [state, []]
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, msg.value) }, []]
    case 'highlightNext': {
      const items = levelItems(state.items, msg.level)
      const to = nextNav(items, state.highlights[msg.level] ?? null, 1)
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, to) }, []]
    }
    case 'highlightPrev': {
      const items = levelItems(state.items, msg.level)
      const to = nextNav(items, state.highlights[msg.level] ?? null, -1)
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, to) }, []]
    }
    case 'highlightFirst':
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
      const parent = findItem(state.items, msg.value)
      if (!parent || !parent.children || parent.disabled) return [state, []]
      const openPath = [...state.openPath, msg.value]
      return [
        {
          ...state,
          openPath,
          highlights: setHighlight(state.highlights, msg.value, firstNav(parent.children)),
        },
        [],
      ]
    }
    case 'closeSub': {
      if (state.openPath.length === 0) return [state, []]
      const deepest = state.openPath[state.openPath.length - 1]!
      const openPath = state.openPath.slice(0, -1)
      const highlights = { ...state.highlights }
      delete highlights[deepest]
      return [{ ...state, openPath, highlights }, []]
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
      const items = levelItems(state.items, msg.level)
      const acc = typeaheadAccumulate(state.typeahead, msg.char, msg.now, state.typeaheadExpiresAt)
      const nav = navigable(items)
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

/** The state patch applied when a selection closes the whole menu. Routes the
 * presence status through `statusOnClose` so animations are honored. */
function closedPatch(
  state: MenuState,
): Pick<MenuState, 'open' | 'status' | 'highlights' | 'openPath' | 'typeahead'> {
  return {
    open: false,
    status: statusOnClose(state.status, state.skipAnimations),
    highlights: { '': null },
    openPath: [],
    typeahead: '',
  }
}

/** Shared selection logic for `select` and `selectHighlighted`. */
function applySelect(state: MenuState, value: string): [MenuState, never[]] {
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

// ---- connect ----

interface ItemAttrs {
  role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'
  id: string
  'aria-disabled': Signal<'true' | undefined>
  'aria-checked'?: Signal<'true' | 'false'>
  'data-state': Signal<'highlighted' | undefined>
  'data-disabled': Signal<'' | undefined>
  'data-scope': 'menu'
  'data-part': 'item'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerMove: (e: PointerEvent) => void
}

export interface MenuItemParts {
  item: ItemAttrs & { role: 'menuitem' }
}

export interface MenuCheckItemParts {
  item: ItemAttrs & {
    role: 'menuitemcheckbox' | 'menuitemradio'
    'aria-checked': Signal<'true' | 'false'>
  }
}

export interface MenuGroupParts {
  group: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'menu'
    'data-part': 'group'
  }
  label: {
    id: string
    'data-scope': 'menu'
    'data-part': 'group-label'
  }
}

export interface MenuSeparatorParts {
  role: 'separator'
  'data-scope': 'menu'
  'data-part': 'separator'
}

export interface MenuSubTriggerParts {
  role: 'menuitem'
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': Signal<boolean>
  'aria-controls': string
  'aria-disabled': Signal<'true' | undefined>
  'data-state': Signal<'highlighted' | undefined>
  'data-scope': 'menu'
  'data-part': 'subtrigger'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface MenuSubPositionerParts {
  'data-scope': 'menu'
  'data-part': 'subpositioner'
  style: string
}

export interface MenuSubContentParts {
  role: 'menu'
  id: string
  'aria-labelledby': string
  tabindex: -1
  'data-state': Signal<'open' | 'closed'>
  'data-scope': 'menu'
  'data-part': 'subcontent'
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface MenuParts {
  trigger: {
    type: 'button'
    'aria-haspopup': 'menu'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    id: string
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'menu'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'menu'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'menu'
    id: string
    'aria-labelledby': string
    tabindex: -1
    /** Reflects the presence lifecycle: 'opening' | 'open' | 'closing' | 'closed'.
     * Stays mounted while 'closing' so the exit animation can run. */
    'data-state': Signal<PresenceStatus>
    'data-scope': 'menu'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  item: (value: string) => MenuItemParts
  checkboxItem: (value: string) => MenuCheckItemParts
  radioItem: (value: string) => MenuCheckItemParts
  group: (label: string) => MenuGroupParts
  separator: () => MenuSeparatorParts
  subTrigger: (value: string) => MenuSubTriggerParts
  subPositioner: (value: string) => MenuSubPositionerParts
  subContent: (value: string) => MenuSubContentParts
}

export interface ConnectOptions {
  id: string
  /** Called when an item is activated (Enter/Space/click). */
  onSelect?: (value: string) => void
  /** ms to wait before opening a submenu on hover (default: 200). */
  hoverDelay?: number
  /** ms to wait before closing a submenu after the pointer leaves (default: 300). */
  hoverCloseDelay?: number
}

export function connect(
  state: Signal<MenuState>,
  send: Send<MenuMsg>,
  opts: ConnectOptions,
): MenuParts {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const itemId = (v: string): string => `${base}:item:${v}`
  const subContentId = (v: string): string => `${base}:sub:${v}:content`
  const subTriggerId = (v: string): string => `${base}:sub:${v}:trigger`
  const groupLabelId = (label: string): string => `${base}:group:${label}`
  const hoverDelay = opts.hoverDelay ?? 200
  const hoverCloseDelay = opts.hoverCloseDelay ?? 300

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
      // Close one level only if this submenu is the deepest open one.
      send({ type: 'closeSub' })
    }, hoverCloseDelay)
  }

  const keyNav = (level: string) =>
    tagSend(
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
          case 'Enter':
          case ' ':
            e.preventDefault()
            send({ type: 'selectHighlighted', level })
            return
          case 'Escape':
            e.preventDefault()
            send({ type: 'close' })
            return
          default:
            if (isTypeaheadKey(e)) {
              send({ type: 'typeahead', level, char: e.key, now: Date.now() })
            }
        }
      },
    )

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      id: triggerId,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'menu',
      'data-part': 'trigger',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
      onKeyDown: tagSend(send, ['open', 'highlightLast'], (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          send({ type: 'open' })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'open' })
          send({ type: 'highlightLast', level: '' })
        }
      }),
    },
    positioner: {
      'data-scope': 'menu',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'menu',
      id: contentId,
      'aria-labelledby': triggerId,
      tabindex: -1,
      'data-state': state.map((s) => s.status),
      'data-scope': 'menu',
      'data-part': 'content',
      onKeyDown: keyNav(''),
      onAnimationEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
      onTransitionEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
    },
    item: (value: string): MenuItemParts => ({
      item: {
        role: 'menuitem',
        id: itemId(value),
        'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
        'data-state': state.map((s) =>
          Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
        ),
        'data-disabled': state.map((s) => (isDisabled(s.items, value) ? '' : undefined)),
        'data-scope': 'menu',
        'data-part': 'item',
        'data-value': value,
        tabindex: -1,
        onClick: tagSend(send, ['select'], () => {
          send({ type: 'select', value })
          opts.onSelect?.(value)
        }),
        onPointerMove: tagSend(send, ['highlight'], () =>
          send({ type: 'highlight', level: levelOf(value), value }),
        ),
      },
    }),
    checkboxItem: (value: string): MenuCheckItemParts => ({
      item: {
        role: 'menuitemcheckbox',
        id: itemId(value),
        'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
        'aria-checked': state.map((s) => (s.checked.includes(value) ? 'true' : 'false')),
        'data-state': state.map((s) =>
          Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
        ),
        'data-disabled': state.map((s) => (isDisabled(s.items, value) ? '' : undefined)),
        'data-scope': 'menu',
        'data-part': 'item',
        'data-value': value,
        tabindex: -1,
        onClick: tagSend(send, ['select'], () => {
          send({ type: 'select', value })
          opts.onSelect?.(value)
        }),
        onPointerMove: tagSend(send, ['highlight'], () =>
          send({ type: 'highlight', level: levelOf(value), value }),
        ),
      },
    }),
    radioItem: (value: string): MenuCheckItemParts => ({
      item: {
        role: 'menuitemradio',
        id: itemId(value),
        'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
        'aria-checked': state.map((s) => (s.checked.includes(value) ? 'true' : 'false')),
        'data-state': state.map((s) =>
          Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
        ),
        'data-disabled': state.map((s) => (isDisabled(s.items, value) ? '' : undefined)),
        'data-scope': 'menu',
        'data-part': 'item',
        'data-value': value,
        tabindex: -1,
        onClick: tagSend(send, ['select'], () => {
          send({ type: 'select', value })
          opts.onSelect?.(value)
        }),
        onPointerMove: tagSend(send, ['highlight'], () =>
          send({ type: 'highlight', level: levelOf(value), value }),
        ),
      },
    }),
    group: (label: string): MenuGroupParts => ({
      group: {
        role: 'group',
        'aria-labelledby': groupLabelId(label),
        'data-scope': 'menu',
        'data-part': 'group',
      },
      label: {
        id: groupLabelId(label),
        'data-scope': 'menu',
        'data-part': 'group-label',
      },
    }),
    separator: (): MenuSeparatorParts => ({
      role: 'separator',
      'data-scope': 'menu',
      'data-part': 'separator',
    }),
    subTrigger: (value: string): MenuSubTriggerParts => ({
      role: 'menuitem',
      id: subTriggerId(value),
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.openPath.includes(value)),
      'aria-controls': subContentId(value),
      'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
      'data-state': state.map((s) =>
        Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
      ),
      'data-scope': 'menu',
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
    subPositioner: (_value: string): MenuSubPositionerParts => ({
      'data-scope': 'menu',
      'data-part': 'subpositioner',
      style: 'position:absolute;top:0;left:0;',
    }),
    subContent: (value: string): MenuSubContentParts => ({
      role: 'menu',
      id: subContentId(value),
      'aria-labelledby': subTriggerId(value),
      tabindex: -1,
      'data-state': state.map((s) => (s.openPath.includes(value) ? 'open' : 'closed')),
      'data-scope': 'menu',
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
  }

  // Resolve which level an item lives at, by walking the tree. Used by
  // pointer highlight so the highlight lands in the correct level bucket.
  function levelOf(value: string): string {
    const s = state.peek()
    const walk = (list: MenuItem[], level: string): string | null => {
      for (const it of list) {
        if (it.value === value) return level
        if (it.children) {
          const nested = walk(it.children, it.value)
          if (nested !== null) return nested
        }
      }
      return null
    }
    return walk(s.items, '') ?? ''
  }
}

export interface OverlayOptions {
  state: Signal<MenuState>
  send: Send<MenuMsg>
  parts: MenuParts
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show(
    opts.state.map((s) => isPresent(s)),
    () => {
      const targetEl =
        typeof rawTarget === 'string'
          ? (document.querySelector(rawTarget) ?? document.body)
          : rawTarget
      return [
        portal(() => {
          const dismissable = onMount(() => {
            const contentEl = document.getElementById(contentId)
            const triggerEl = document.getElementById(triggerId)
            if (!contentEl || !triggerEl) return

            const cleanups: Array<() => void> = []

            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            cleanups.push(
              attachFloating({
                anchor: triggerEl,
                floating: floatingEl,
                placement,
                offset,
                flip,
                shift,
                dir: opts.state.peek().dir,
              }),
            )

            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => [triggerEl],
                onDismiss: () => {
                  opts.send({ type: 'close' })
                  triggerEl.focus()
                },
              }),
            )

            contentEl.focus({ preventScroll: true })

            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, targetEl),
      ]
    },
  )
}

export const menu = { init, update, connect, overlay, isPresent, isMounted }
