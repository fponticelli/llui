import type { Send, Signal, Mountable, Renderable, TransitionOptions } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { type Placement } from '../utils/floating.js'
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
  closedPatch,
  reduceMenuTree,
  firstNav,
  setHighlight,
  createMenuTreeParts,
  activeMenuHighlight,
} from './menu-machine.js'

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
export type MenuItemKind = MenuNodeKind

/** A single node in the menu item tree (JSON-serializable). Shared with
 * `context-menu` (and `menubar`) via the {@link MenuNode} machine type. */
export type MenuItem = MenuNode

export interface MenuState extends MenuTreeState {
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

// ---- presence lifecycle (composes the shared machine's status helpers) ----

/** Whether the root menu content should be in the DOM. True for every status
 * except 'closed' — so the content stays mounted through the exit animation. */
export function isPresent(state: MenuState): boolean {
  return presence.isMounted({ status: state.status, unmountOnExit: true })
}

/** Alias of {@link isPresent} for parity with the presence-convention naming. */
export const isMounted = isPresent

/** Whether the menu is in its VISIBLE phase (open/opening) — as opposed to merely
 * still mounted for an exit animation ('closing'). Interaction wiring (floating,
 * dismissable, focus) is gated on this so it tears down at the close REQUEST, not
 * at animation end. Tolerates a partial slice without `status` (falls back to open). */
function isVisible(state: MenuState): boolean {
  return state.status === undefined
    ? state.open
    : state.status === 'open' || state.status === 'opening'
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
    case 'toggle':
      if (state.open) {
        return [{ ...state, ...closedPatch(state) }, []]
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
    // close, highlight family, select, openSub/closeSub, typeahead, setDir,
    // animationEnd — all shared with context-menu / menubar.
    default:
      return reduceMenuTree(state, msg)
  }
}

// ---- connect ----

// Item / group / separator / submenu part shapes come from the shared machine,
// specialized to this component's `data-scope: 'menu'`.
export type MenuItemParts = MenuItemPartsOf<'menu'>
export type MenuCheckItemParts = MenuCheckItemPartsOf<'menu'>
export type MenuGroupParts = MenuGroupPartsOf<'menu'>
export type MenuSeparatorParts = MenuSeparatorPartsOf<'menu'>
export type MenuSubTriggerParts = MenuSubTriggerPartsOf<'menu'>
export type MenuSubPositionerParts = MenuSubPositionerPartsOf<'menu'>
export type MenuSubContentParts = MenuSubContentPartsOf<'menu'>

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
    /** The id of the virtually-focused (highlighted) item at the root level, so
     * assistive tech announces it while DOM focus stays on the container. */
    'aria-activedescendant': Signal<string | undefined>
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
  group: (id: string) => MenuGroupParts
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
  // `group()` takes an OPAQUE id, not display text: interpolating multi-word
  // label text into an element id produced invalid ids / broken
  // aria-labelledby references.
  const groupLabelId = (id: string): string => `${base}:group:${id}:label`

  // The item / submenu / group parts + hover-intent timers + level resolver +
  // root keydown all come from the shared item-tree machine.
  const parts = createMenuTreeParts({
    scope: 'menu',
    state,
    send,
    ids: { itemId, subContentId, subTriggerId, groupLabelId },
    onSelect: opts.onSelect,
    hoverDelay: opts.hoverDelay,
    hoverCloseDelay: opts.hoverCloseDelay,
  })

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
      'aria-activedescendant': state.map((s) => {
        const v = activeMenuHighlight(s)
        return v == null ? undefined : itemId(v)
      }),
      tabindex: -1,
      'data-state': state.map((s) => s.status),
      'data-scope': 'menu',
      'data-part': 'content',
      onKeyDown: parts.rootKeyNav,
      onAnimationEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
      onTransitionEnd: tagSend(send, ['animationEnd'], () => send({ type: 'animationEnd' })),
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
  state: Signal<MenuState>
  send: Send<MenuMsg>
  parts: MenuParts
  content: () => Renderable
  /**
   * Optional enter/leave transition for the menu content (from
   * `@llui/transitions`). `enter` animates it in on open; `leave` defers the
   * unmount until its promise resolves, so the close plays an exit animation.
   * Keep `skipAnimations` at its default (true) when driving exits this way.
   *
   * @example menu.overlay({ state, send, parts, content, transition: fade({ duration: 120 }) })
   */
  transition?: TransitionOptions
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  // Two-phase: mounted through the exit animation (isPresent); floating +
  // dismissable + content focus unwind at the close REQUEST (isVisible). Focus is
  // restored to the trigger on EVERY close when it is still inside the overlay.
  return createOverlay({
    state: opts.state,
    transition: opts.transition,
    host: resolvePortalTarget(opts.target ?? 'body'),
    positioner: opts.parts.positioner,
    content: opts.content,
    contentId: opts.parts.content.id,
    anchorId: opts.parts.trigger.id,
    requireAnchor: true,
    mountWhen: isPresent,
    visibleWhen: isVisible,
    onDismiss: () => opts.send({ type: 'close' }),
    floating: {
      placement: opts.placement ?? 'bottom-start',
      offset: opts.offset ?? 4,
      flip: opts.flip !== false,
      shift: opts.shift !== false,
      dir: () => opts.state.peek().dir,
    },
    dismiss: {},
    focusOnOpenId: opts.parts.content.id,
    restoreFocus: { boundary: 'content' },
  })
}

export const menu = { init, update, connect, overlay, isPresent, isMounted }
