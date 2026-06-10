import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable.js'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

/**
 * Context menu — right-click (contextmenu) triggered menu positioned at the
 * pointer. Unlike the regular menu it has no trigger button — the user
 * right-clicks anywhere in the associated region.
 *
 * Shares the menu's JSON-serializable item tree: submenus, checkbox/radio
 * items, groups, and separators. The root content is positioned at the
 * pointer (raw x/y); submenus position against their trigger via floating-ui.
 */

/** Kind of a context-menu item. */
export type ContextMenuItemKind = 'action' | 'checkbox' | 'radio' | 'separator'

/** A single node in the context-menu item tree (JSON-serializable). */
export interface ContextMenuItem {
  value: string
  kind: ContextMenuItemKind
  group?: string
  children?: ContextMenuItem[]
  disabled?: boolean
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  /** Highlighted value per open level. Key `''` is the root. */
  highlights: Record<string, string | null>
  /** Chain of subTrigger values whose submenus are open (deepest last). */
  openPath: string[]
  /** Checked checkbox / radio values. */
  checked: string[]
  /** When true, selecting a checkbox/radio also closes the menu (default false). */
  closeOnSelect: boolean
  typeahead: string
  typeaheadExpiresAt: number
}

export type ContextMenuMsg =
  /** @humanOnly */
  | { type: 'openAt'; x: number; y: number }
  /** @intent("Close the context menu") */
  | { type: 'close' }
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
  | { type: 'setItems'; items: ContextMenuItem[] }
  /** @humanOnly */
  | { type: 'typeahead'; level: string; char: string; now: number }

export interface ContextMenuInit {
  items?: ContextMenuItem[]
  checked?: string[]
  closeOnSelect?: boolean
}

export function init(opts: ContextMenuInit = {}): ContextMenuState {
  return {
    open: false,
    x: 0,
    y: 0,
    items: opts.items ?? [],
    highlights: { '': null },
    openPath: [],
    checked: opts.checked ?? [],
    closeOnSelect: opts.closeOnSelect ?? false,
    typeahead: '',
    typeaheadExpiresAt: 0,
  }
}

// ---- item-tree helpers (pure) ----

function findItem(items: ContextMenuItem[], value: string): ContextMenuItem | null {
  for (const it of items) {
    if (it.value === value) return it
    if (it.children) {
      const nested = findItem(it.children, value)
      if (nested) return nested
    }
  }
  return null
}

function levelItems(items: ContextMenuItem[], level: string): ContextMenuItem[] {
  if (level === '') return items
  const parent = findItem(items, level)
  return parent?.children ?? []
}

function navigable(items: ContextMenuItem[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.kind === 'separator') continue
    if (it.disabled) continue
    out.push(it.value)
  }
  return out
}

function firstNav(items: ContextMenuItem[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[0]! : null
}

function lastNav(items: ContextMenuItem[]): string | null {
  const nav = navigable(items)
  return nav.length > 0 ? nav[nav.length - 1]! : null
}

function nextNav(items: ContextMenuItem[], from: string | null, delta: 1 | -1): string | null {
  const nav = navigable(items)
  if (nav.length === 0) return null
  const start = from === null ? -1 : nav.indexOf(from)
  const n = nav.length
  const idx = start === -1 && delta === 1 ? 0 : (((start + delta) % n) + n) % n
  return nav[idx]!
}

function isDisabled(items: ContextMenuItem[], value: string): boolean {
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

function toggleChecked(checked: string[], value: string): string[] {
  return checked.includes(value) ? checked.filter((v) => v !== value) : [...checked, value]
}

function collectGroupValues(items: ContextMenuItem[], group: string): string[] {
  const out: string[] = []
  const walk = (list: ContextMenuItem[]): void => {
    for (const it of list) {
      if (it.kind === 'radio' && it.group === group) out.push(it.value)
      if (it.children) walk(it.children)
    }
  }
  walk(items)
  return out
}

function selectRadio(items: ContextMenuItem[], checked: string[], item: ContextMenuItem): string[] {
  const group = item.group
  const siblings = group ? collectGroupValues(items, group) : [item.value]
  return [...checked.filter((v) => !siblings.includes(v)), item.value]
}

export function update(state: ContextMenuState, msg: ContextMenuMsg): [ContextMenuState, never[]] {
  switch (msg.type) {
    case 'openAt':
      return [
        {
          ...state,
          open: true,
          x: msg.x,
          y: msg.y,
          openPath: [],
          highlights: { '': firstNav(state.items) },
        },
        [],
      ]
    case 'close':
      return [{ ...state, open: false, highlights: { '': null }, openPath: [], typeahead: '' }, []]
    case 'highlight':
      if (msg.value !== null && isDisabled(state.items, msg.value)) return [state, []]
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, msg.value) }, []]
    case 'highlightNext': {
      const to = nextNav(levelItems(state.items, msg.level), state.highlights[msg.level] ?? null, 1)
      return [{ ...state, highlights: setHighlight(state.highlights, msg.level, to) }, []]
    }
    case 'highlightPrev': {
      const to = nextNav(
        levelItems(state.items, msg.level),
        state.highlights[msg.level] ?? null,
        -1,
      )
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
  }
}

function applySelect(state: ContextMenuState, value: string): [ContextMenuState, never[]] {
  const item = findItem(state.items, value)
  if (!item || item.disabled || item.kind === 'separator') return [state, []]

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
      return [
        { ...state, checked, open: false, highlights: { '': null }, openPath: [], typeahead: '' },
        [],
      ]
    }
    return [{ ...state, checked }, []]
  }

  if (item.kind === 'radio') {
    const checked = selectRadio(state.items, state.checked, item)
    if (state.closeOnSelect) {
      return [
        { ...state, checked, open: false, highlights: { '': null }, openPath: [], typeahead: '' },
        [],
      ]
    }
    return [{ ...state, checked }, []]
  }

  return [{ ...state, open: false, highlights: { '': null }, openPath: [], typeahead: '' }, []]
}

// ---- connect ----

interface ItemAttrs {
  role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio'
  id: string
  'aria-disabled': Signal<'true' | undefined>
  'aria-checked'?: Signal<'true' | 'false'>
  'data-state': Signal<'highlighted' | undefined>
  'data-disabled': Signal<'' | undefined>
  'data-scope': 'context-menu'
  'data-part': 'item'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerMove: (e: PointerEvent) => void
}

export interface ContextMenuItemParts {
  item: ItemAttrs & { role: 'menuitem' }
}

export interface ContextMenuCheckItemParts {
  item: ItemAttrs & {
    role: 'menuitemcheckbox' | 'menuitemradio'
    'aria-checked': Signal<'true' | 'false'>
  }
}

export interface ContextMenuGroupParts {
  group: {
    role: 'group'
    'aria-labelledby': string
    'data-scope': 'context-menu'
    'data-part': 'group'
  }
  label: {
    id: string
    'data-scope': 'context-menu'
    'data-part': 'group-label'
  }
}

export interface ContextMenuSeparatorParts {
  role: 'separator'
  'data-scope': 'context-menu'
  'data-part': 'separator'
}

export interface ContextMenuSubTriggerParts {
  role: 'menuitem'
  id: string
  'aria-haspopup': 'menu'
  'aria-expanded': Signal<boolean>
  'aria-controls': string
  'aria-disabled': Signal<'true' | undefined>
  'data-state': Signal<'highlighted' | undefined>
  'data-scope': 'context-menu'
  'data-part': 'subtrigger'
  'data-value': string
  tabindex: -1
  onClick: (e: MouseEvent) => void
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface ContextMenuSubPositionerParts {
  'data-scope': 'context-menu'
  'data-part': 'subpositioner'
  style: string
}

export interface ContextMenuSubContentParts {
  role: 'menu'
  id: string
  'aria-labelledby': string
  tabindex: -1
  'data-state': Signal<'open' | 'closed'>
  'data-scope': 'context-menu'
  'data-part': 'subcontent'
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

export interface ContextMenuParts {
  /** The element users right-click to open the menu. */
  trigger: {
    'data-scope': 'context-menu'
    'data-part': 'trigger'
    onContextMenu: (e: MouseEvent) => void
  }
  positioner: {
    'data-scope': 'context-menu'
    'data-part': 'positioner'
    style: Signal<string>
  }
  content: {
    role: 'menu'
    id: string
    tabindex: -1
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'context-menu'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (value: string) => ContextMenuItemParts
  checkboxItem: (value: string) => ContextMenuCheckItemParts
  radioItem: (value: string) => ContextMenuCheckItemParts
  group: (label: string) => ContextMenuGroupParts
  separator: () => ContextMenuSeparatorParts
  subTrigger: (value: string) => ContextMenuSubTriggerParts
  subPositioner: (value: string) => ContextMenuSubPositionerParts
  subContent: (value: string) => ContextMenuSubContentParts
}

export interface ConnectOptions {
  id: string
  onSelect?: (value: string) => void
  /** ms to wait before opening a submenu on hover (default: 200). */
  hoverDelay?: number
  /** ms to wait before closing a submenu after the pointer leaves (default: 300). */
  hoverCloseDelay?: number
}

export function connect(
  state: Signal<ContextMenuState>,
  send: Send<ContextMenuMsg>,
  opts: ConnectOptions,
): ContextMenuParts {
  const base = opts.id
  const contentId = `${base}:content`
  const itemId = (v: string): string => `${base}:item:${v}`
  const subContentId = (v: string): string => `${base}:sub:${v}:content`
  const subTriggerId = (v: string): string => `${base}:sub:${v}:trigger`
  const groupLabelId = (label: string): string => `${base}:group:${label}`
  const hoverDelay = opts.hoverDelay ?? 200
  const hoverCloseDelay = opts.hoverCloseDelay ?? 300

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
      send({ type: 'closeSub' })
    }, hoverCloseDelay)
  }

  function levelOf(value: string): string {
    const s = state.peek()
    const walk = (list: ContextMenuItem[], level: string): string | null => {
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

  const itemAttrs = (
    value: string,
    role: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio',
  ): ItemAttrs => ({
    role,
    id: itemId(value),
    'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
    ...(role === 'menuitem'
      ? {}
      : {
          'aria-checked': state.map((s): 'true' | 'false' =>
            s.checked.includes(value) ? 'true' : 'false',
          ),
        }),
    'data-state': state.map((s) =>
      Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
    ),
    'data-disabled': state.map((s) => (isDisabled(s.items, value) ? '' : undefined)),
    'data-scope': 'context-menu',
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
  })

  return {
    trigger: {
      'data-scope': 'context-menu',
      'data-part': 'trigger',
      onContextMenu: tagSend(send, ['openAt'], (e) => {
        e.preventDefault()
        send({ type: 'openAt', x: e.clientX, y: e.clientY })
      }),
    },
    positioner: {
      'data-scope': 'context-menu',
      'data-part': 'positioner',
      style: state.map((st) => `position:fixed;top:${st.y}px;left:${st.x}px;`),
    },
    content: {
      role: 'menu',
      id: contentId,
      tabindex: -1,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'context-menu',
      'data-part': 'content',
      onKeyDown: tagSend(
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
        (e) => {
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
      ),
    },
    item: (value: string): ContextMenuItemParts => ({
      item: itemAttrs(value, 'menuitem') as ItemAttrs & { role: 'menuitem' },
    }),
    checkboxItem: (value: string): ContextMenuCheckItemParts => ({
      item: itemAttrs(value, 'menuitemcheckbox') as ItemAttrs & {
        role: 'menuitemcheckbox'
        'aria-checked': Signal<'true' | 'false'>
      },
    }),
    radioItem: (value: string): ContextMenuCheckItemParts => ({
      item: itemAttrs(value, 'menuitemradio') as ItemAttrs & {
        role: 'menuitemradio'
        'aria-checked': Signal<'true' | 'false'>
      },
    }),
    group: (label: string): ContextMenuGroupParts => ({
      group: {
        role: 'group',
        'aria-labelledby': groupLabelId(label),
        'data-scope': 'context-menu',
        'data-part': 'group',
      },
      label: {
        id: groupLabelId(label),
        'data-scope': 'context-menu',
        'data-part': 'group-label',
      },
    }),
    separator: (): ContextMenuSeparatorParts => ({
      role: 'separator',
      'data-scope': 'context-menu',
      'data-part': 'separator',
    }),
    subTrigger: (value: string): ContextMenuSubTriggerParts => ({
      role: 'menuitem',
      id: subTriggerId(value),
      'aria-haspopup': 'menu',
      'aria-expanded': state.map((s) => s.openPath.includes(value)),
      'aria-controls': subContentId(value),
      'aria-disabled': state.map((s) => (isDisabled(s.items, value) ? 'true' : undefined)),
      'data-state': state.map((s) =>
        Object.values(s.highlights).includes(value) ? 'highlighted' : undefined,
      ),
      'data-scope': 'context-menu',
      'data-part': 'subtrigger',
      'data-value': value,
      tabindex: -1,
      onClick: tagSend(send, ['openSub'], () => send({ type: 'openSub', value })),
      onPointerEnter: () => scheduleOpenSub(value),
      onPointerLeave: () => scheduleCloseSub(value),
      onKeyDown: tagSend(send, ['openSub', 'highlightNext', 'highlightPrev', 'close'], (e) => {
        switch (e.key) {
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
    subPositioner: (_value: string): ContextMenuSubPositionerParts => ({
      'data-scope': 'context-menu',
      'data-part': 'subpositioner',
      style: 'position:absolute;top:0;left:0;',
    }),
    subContent: (value: string): ContextMenuSubContentParts => ({
      role: 'menu',
      id: subContentId(value),
      'aria-labelledby': subTriggerId(value),
      tabindex: -1,
      'data-state': state.map((s) => (s.openPath.includes(value) ? 'open' : 'closed')),
      'data-scope': 'context-menu',
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
          switch (e.key) {
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
}

export interface OverlayOptions {
  state: Signal<ContextMenuState>
  send: Send<ContextMenuMsg>
  parts: ContextMenuParts
  content: () => Renderable
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  const rawTarget = opts.target ?? 'body'
  const parts = opts.parts
  const contentId = parts.content.id

  return show(
    opts.state.map((s) => s.open),
    () => {
      const targetEl =
        typeof rawTarget === 'string'
          ? (document.querySelector(rawTarget) ?? document.body)
          : rawTarget
      return [
        portal(() => {
          const dismissable = onMount(() => {
            const contentEl = document.getElementById(contentId)
            if (!contentEl) return
            contentEl.focus({ preventScroll: true })
            const cleanup = pushDismissable({
              element: contentEl,
              onDismiss: () => opts.send({ type: 'close' }),
            })
            return cleanup
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, targetEl),
      ]
    },
  )
}

export const contextMenu = { init, update, connect, overlay }
