import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { resolvePortalTarget } from '../utils/portal-target.js'
import { createOverlay } from '../utils/overlay-engine.js'
import { presence, type PresenceStatus } from './presence.js'
import {
  type MenuNode,
  type MenuNodeKind,
  type MenuTreeState,
  type MenuItemPartsOf,
  type MenuCheckItemPartsOf,
  type MenuGroupPartsOf,
  type MenuSeparatorPartsOf,
  type MenuSubTriggerPartsOf,
  type MenuSubPositionerPartsOf,
  type MenuSubContentPartsOf,
  statusOnOpen,
  reduceMenuTree,
  firstNav,
  createMenuTreeParts,
} from './menu-machine.js'

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
export type ContextMenuItemKind = MenuNodeKind

/** A single node in the context-menu item tree (JSON-serializable). Shared with
 * `menu` via the {@link MenuNode} machine type. */
export type ContextMenuItem = MenuNode

/** Context-menu state — the shared menu-tree state plus the pointer (x, y) the
 * root content is positioned at. */
export interface ContextMenuState extends MenuTreeState {
  x: number
  y: number
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
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }
  /** @humanOnly */
  | { type: 'animationEnd' }

export interface ContextMenuInit {
  items?: ContextMenuItem[]
  checked?: string[]
  closeOnSelect?: boolean
  dir?: 'ltr' | 'rtl'
  /** When false, closing the menu plays an exit animation and the content stays
   * mounted (status 'closing') until an `animationEnd`. Default true: instant. */
  skipAnimations?: boolean
}

export function init(opts: ContextMenuInit = {}): ContextMenuState {
  return {
    open: false,
    status: 'closed',
    skipAnimations: opts.skipAnimations ?? true,
    x: 0,
    y: 0,
    items: opts.items ?? [],
    highlights: { '': null },
    openPath: [],
    checked: opts.checked ?? [],
    closeOnSelect: opts.closeOnSelect ?? false,
    typeahead: '',
    typeaheadExpiresAt: 0,
    dir: opts.dir ?? 'ltr',
  }
}

// ---- presence lifecycle (composes the shared machine's status helpers) ----

/** Whether the root content should be in the DOM. True for every status except
 * 'closed' — so the content stays mounted through the exit animation. Falls back
 * to `open` when a consumer drives `open` directly without advancing `status`
 * (backward-compatible with open-driven callers that predate the presence
 * lifecycle): an `open` menu is present even if `status` still reads 'closed'. */
export function isPresent(state: ContextMenuState): boolean {
  if (state.open) return true
  return presence.isMounted({ status: state.status, unmountOnExit: true })
}

/** Alias of {@link isPresent} for parity with the presence-convention naming. */
export const isMounted = isPresent

/** Whether the menu is in its VISIBLE phase (open/opening) vs merely still mounted
 * for an exit animation ('closing'). Interaction wiring (dismissable, focus) is
 * gated on this so it tears down at the close REQUEST, not at animation end.
 * Mirrors {@link isPresent}'s open-driven backward-compat: a caller that drives
 * `open` directly without advancing `status` is still treated as visible. */
function isVisible(state: ContextMenuState): boolean {
  if (state.status === 'closing') return false
  if (state.status === 'open' || state.status === 'opening') return true
  return state.open
}

export function update(state: ContextMenuState, msg: ContextMenuMsg): [ContextMenuState, never[]] {
  switch (msg.type) {
    case 'openAt':
      return [
        {
          ...state,
          open: true,
          status: statusOnOpen(state.status),
          x: msg.x,
          y: msg.y,
          openPath: [],
          highlights: { '': firstNav(state.items) },
        },
        [],
      ]
    // close, highlight family, select, openSub/closeSub, typeahead, setDir,
    // animationEnd — all shared with menu / menubar.
    default:
      return reduceMenuTree(state, msg)
  }
}

// ---- connect ----

// Item / group / separator / submenu part shapes come from the shared machine,
// specialized to this component's `data-scope: 'context-menu'`.
export type ContextMenuItemParts = MenuItemPartsOf<'context-menu'>
export type ContextMenuCheckItemParts = MenuCheckItemPartsOf<'context-menu'>
export type ContextMenuGroupParts = MenuGroupPartsOf<'context-menu'>
export type ContextMenuSeparatorParts = MenuSeparatorPartsOf<'context-menu'>
export type ContextMenuSubTriggerParts = MenuSubTriggerPartsOf<'context-menu'>
export type ContextMenuSubPositionerParts = MenuSubPositionerPartsOf<'context-menu'>
export type ContextMenuSubContentParts = MenuSubContentPartsOf<'context-menu'>

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
    /** Virtually-focused (highlighted) item id at the root level. */
    'aria-activedescendant': Signal<string | undefined>
    tabindex: -1
    /** Reflects the presence lifecycle: 'opening' | 'open' | 'closing' | 'closed'.
     * Stays mounted while 'closing' so the exit animation can run. */
    'data-state': Signal<PresenceStatus>
    'data-scope': 'context-menu'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
  item: (value: string) => ContextMenuItemParts
  checkboxItem: (value: string) => ContextMenuCheckItemParts
  radioItem: (value: string) => ContextMenuCheckItemParts
  group: (id: string) => ContextMenuGroupParts
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
  // Opaque id, not display text: multi-word label text would yield invalid ids.
  const groupLabelId = (id: string): string => `${base}:group:${id}:label`

  // The item / submenu / group parts + hover-intent timers + level resolver +
  // root keydown all come from the shared item-tree machine.
  const parts = createMenuTreeParts({
    scope: 'context-menu',
    state,
    send,
    ids: { itemId, subContentId, subTriggerId, groupLabelId },
    onSelect: opts.onSelect,
    hoverDelay: opts.hoverDelay,
    hoverCloseDelay: opts.hoverCloseDelay,
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
      'aria-activedescendant': state.map((s) => {
        const v = s.highlights['']
        return v == null ? undefined : itemId(v)
      }),
      tabindex: -1,
      'data-state': state.map((s) => (s.status === 'closed' && s.open ? 'open' : s.status)),
      'data-scope': 'context-menu',
      'data-part': 'content',
      onAnimationEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
      onTransitionEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
      onKeyDown: parts.rootKeyNav,
    },
    item: parts.item,
    checkboxItem: parts.checkboxItem,
    radioItem: parts.radioItem,
    group: parts.group,
    separator: parts.separator,
    subTrigger: parts.subTrigger,
    subPositioner: parts.subPositioner,
    subContent: parts.subContent,
  }
}

export interface OverlayOptions {
  state: Signal<ContextMenuState>
  send: Send<ContextMenuMsg>
  parts: ContextMenuParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the context-menu content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Keep `skipAnimations` at its default (true) when driving exits this way.
   *
   * @example contextMenu.overlay({ state, send, parts, content, transition: fade({ duration: 120 }) })
   */
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  // Two-phase: mounted through the exit animation (isPresent); the content focus
  // + dismissable unwind at the close REQUEST (isVisible). No floating — the
  // positioner is placed at the virtual (x, y) anchor set by `openAt`.
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    mountWhen: isPresent,
    visibleWhen: isVisible,
    onDismiss: () => opts.send({ type: 'close' }),
    dismiss: {},
    focusOnOpenId: opts.parts.content.id,
  })
}

export const contextMenu = { init, update, connect, overlay, isPresent, isMounted }
