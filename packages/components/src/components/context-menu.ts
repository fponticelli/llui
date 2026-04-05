import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable'

/**
 * Context menu — right-click (contextmenu) triggered menu positioned at
 * the pointer. Unlike regular menu, it has no trigger button — the user
 * right-clicks anywhere in the associated region.
 *
 * Uses raw x/y positioning instead of floating-ui (pointer is the anchor,
 * not an element).
 */

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: string[]
  disabledItems: string[]
  highlighted: string | null
}

export type ContextMenuMsg =
  | { type: 'openAt'; x: number; y: number }
  | { type: 'close' }
  | { type: 'highlight'; value: string | null }
  | { type: 'highlightNext' }
  | { type: 'highlightPrev' }
  | { type: 'selectHighlighted' }
  | { type: 'select'; value: string }
  | { type: 'setItems'; items: string[]; disabled?: string[] }

export interface ContextMenuInit {
  items?: string[]
  disabledItems?: string[]
}

export function init(opts: ContextMenuInit = {}): ContextMenuState {
  return {
    open: false,
    x: 0,
    y: 0,
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    highlighted: null,
  }
}

function firstEnabled(items: string[], disabled: string[]): string | null {
  for (const v of items) if (!disabled.includes(v)) return v
  return null
}

function nextEnabled(
  items: string[],
  disabled: string[],
  from: string | null,
  delta: 1 | -1,
): string | null {
  if (items.length === 0) return null
  const start = from === null ? -1 : items.indexOf(from)
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const idx = start === -1 && delta === 1 ? i - 1 : (start + delta * i + n * n) % n
    const v = items[idx]!
    if (!disabled.includes(v)) return v
  }
  return null
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
          highlighted: firstEnabled(state.items, state.disabledItems),
        },
        [],
      ]
    case 'close':
      return [{ ...state, open: false, highlighted: null }, []]
    case 'highlight':
      if (msg.value !== null && state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, highlighted: msg.value }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlighted: nextEnabled(state.items, state.disabledItems, state.highlighted, 1),
        },
        [],
      ]
    case 'highlightPrev':
      return [
        {
          ...state,
          highlighted: nextEnabled(state.items, state.disabledItems, state.highlighted, -1),
        },
        [],
      ]
    case 'selectHighlighted':
      if (state.highlighted === null) return [state, []]
      return [{ ...state, open: false, highlighted: null }, []]
    case 'select':
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, open: false, highlighted: null }, []]
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      return [{ ...state, items: msg.items, disabledItems: disabled }, []]
    }
  }
}

export interface ContextMenuItemParts<S> {
  item: {
    role: 'menuitem'
    id: string
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'highlighted' | undefined
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'context-menu'
    'data-part': 'item'
    'data-value': string
    tabIndex: -1
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ContextMenuParts<S> {
  /** The element users right-click to open the menu. */
  trigger: {
    'data-scope': 'context-menu'
    'data-part': 'trigger'
    onContextMenu: (e: MouseEvent) => void
  }
  positioner: {
    'data-scope': 'context-menu'
    'data-part': 'positioner'
    style: (s: S) => string
  }
  content: {
    role: 'menu'
    id: string
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'context-menu'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (value: string) => ContextMenuItemParts<S>
}

export interface ConnectOptions {
  id: string
  onSelect?: (value: string) => void
}

export function connect<S>(
  get: (s: S) => ContextMenuState,
  send: Send<ContextMenuMsg>,
  opts: ConnectOptions,
): ContextMenuParts<S> {
  const contentId = `${opts.id}:content`
  const itemId = (v: string): string => `${opts.id}:item:${v}`

  return {
    trigger: {
      'data-scope': 'context-menu',
      'data-part': 'trigger',
      onContextMenu: (e) => {
        e.preventDefault()
        send({ type: 'openAt', x: e.clientX, y: e.clientY })
      },
    },
    positioner: {
      'data-scope': 'context-menu',
      'data-part': 'positioner',
      style: (s) => {
        const st = get(s)
        return `position:fixed;top:${st.y}px;left:${st.x}px;`
      },
    },
    content: {
      role: 'menu',
      id: contentId,
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'context-menu',
      'data-part': 'content',
      onKeyDown: (e) => {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'highlightNext' })
            return
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'highlightPrev' })
            return
          case 'Enter':
          case ' ':
            e.preventDefault()
            send({ type: 'selectHighlighted' })
            return
          case 'Escape':
            e.preventDefault()
            send({ type: 'close' })
            return
        }
      },
    },
    item: (value: string): ContextMenuItemParts<S> => ({
      item: {
        role: 'menuitem',
        id: itemId(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        'data-state': (s) => (get(s).highlighted === value ? 'highlighted' : undefined),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'context-menu',
        'data-part': 'item',
        'data-value': value,
        tabIndex: -1,
        onClick: () => {
          send({ type: 'select', value })
          opts.onSelect?.(value)
        },
        onPointerMove: () => send({ type: 'highlight', value }),
      },
    }),
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => ContextMenuState
  send: Send<ContextMenuMsg>
  parts: ContextMenuParts<S>
  content: () => Node[]
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const parts = opts.parts
  const contentId = parts.content.id

  return show<S, ContextMenuMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
            const contentEl = document.getElementById(contentId)
            if (!contentEl) return
            contentEl.focus({ preventScroll: true })
            const cleanup = pushDismissable({
              element: contentEl,
              onDismiss: () => opts.send({ type: 'close' }),
            })
            return cleanup
          })
          return [div(parts.positioner, opts.content())]
        },
      }),
    enter: opts.transition?.enter,
    leave: opts.transition?.leave,
  })
}

export const contextMenu = { init, update, connect, overlay }
