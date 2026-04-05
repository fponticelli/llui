import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable'
import { attachFloating, type Placement } from '../utils/floating'

/**
 * Menu — a dropdown list of items triggered by a button. Keyboard navigation
 * (arrows, Home, End), typeahead (first-letter matching), Enter/Space to
 * activate the focused item, Escape to close.
 *
 * Items are opaque string values (keys); the user's view renders the
 * label/icon/etc. The machine tracks which item is currently "highlighted"
 * (= the one that will activate on Enter). On open, the first item is
 * highlighted by default unless `defaultHighlighted` is provided.
 */

export interface MenuState {
  open: boolean
  items: string[]
  disabledItems: string[]
  highlighted: string | null
  /** Accumulator for typeahead search. */
  typeahead: string
  typeaheadExpiresAt: number
}

export type MenuMsg =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'highlight'; value: string | null }
  | { type: 'highlightNext' }
  | { type: 'highlightPrev' }
  | { type: 'highlightFirst' }
  | { type: 'highlightLast' }
  | { type: 'selectHighlighted' }
  | { type: 'select'; value: string }
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  | { type: 'typeahead'; char: string; now: number }

export interface MenuInit {
  open?: boolean
  items?: string[]
  disabledItems?: string[]
  highlighted?: string | null
}

const TYPEAHEAD_TIMEOUT_MS = 500

export function init(opts: MenuInit = {}): MenuState {
  return {
    open: opts.open ?? false,
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    highlighted: opts.highlighted ?? null,
    typeahead: '',
    typeaheadExpiresAt: 0,
  }
}

function firstEnabled(items: string[], disabled: string[]): string | null {
  for (const v of items) if (!disabled.includes(v)) return v
  return null
}

function lastEnabled(items: string[], disabled: string[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const v = items[i]!
    if (!disabled.includes(v)) return v
  }
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

export function update(state: MenuState, msg: MenuMsg): [MenuState, never[]] {
  switch (msg.type) {
    case 'open': {
      const highlighted = state.highlighted ?? firstEnabled(state.items, state.disabledItems)
      return [{ ...state, open: true, highlighted }, []]
    }
    case 'close':
      return [{ ...state, open: false, highlighted: null, typeahead: '' }, []]
    case 'toggle':
      if (state.open) {
        return [{ ...state, open: false, highlighted: null, typeahead: '' }, []]
      }
      return [
        {
          ...state,
          open: true,
          highlighted: state.highlighted ?? firstEnabled(state.items, state.disabledItems),
        },
        [],
      ]
    case 'highlight':
      if (msg.value !== null && state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, highlighted: msg.value }, []]
    case 'highlightNext': {
      const to = nextEnabled(state.items, state.disabledItems, state.highlighted, 1)
      return [{ ...state, highlighted: to }, []]
    }
    case 'highlightPrev': {
      const to = nextEnabled(state.items, state.disabledItems, state.highlighted, -1)
      return [{ ...state, highlighted: to }, []]
    }
    case 'highlightFirst':
      return [{ ...state, highlighted: firstEnabled(state.items, state.disabledItems) }, []]
    case 'highlightLast':
      return [{ ...state, highlighted: lastEnabled(state.items, state.disabledItems) }, []]
    case 'selectHighlighted':
      if (state.highlighted === null) return [state, []]
      return [{ ...state, open: false, highlighted: null, typeahead: '' }, []]
    case 'select':
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, open: false, highlighted: null, typeahead: '' }, []]
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const highlighted =
        state.highlighted &&
        msg.items.includes(state.highlighted) &&
        !disabled.includes(state.highlighted)
          ? state.highlighted
          : null
      return [{ ...state, items: msg.items, disabledItems: disabled, highlighted }, []]
    }
    case 'typeahead': {
      const acc = msg.now < state.typeaheadExpiresAt ? state.typeahead + msg.char : msg.char
      const match = typeaheadMatch(state.items, state.disabledItems, acc, state.highlighted)
      return [
        {
          ...state,
          typeahead: acc,
          typeaheadExpiresAt: msg.now + TYPEAHEAD_TIMEOUT_MS,
          highlighted: match ?? state.highlighted,
        },
        [],
      ]
    }
  }
}

function typeaheadMatch(
  items: string[],
  disabled: string[],
  query: string,
  startFrom: string | null,
): string | null {
  if (items.length === 0 || query.length === 0) return null
  const q = query.toLowerCase()
  const startIdx = startFrom ? items.indexOf(startFrom) : -1
  // If query is a single char, advance to next match after current; else search from current.
  const offset = query.length === 1 ? 1 : 0
  const n = items.length
  for (let i = 0; i < n; i++) {
    const idx = (startIdx + offset + i + n) % n
    const v = items[idx]!
    if (disabled.includes(v)) continue
    if (v.toLowerCase().startsWith(q)) return v
  }
  return null
}

export interface MenuItemParts<S> {
  item: {
    role: 'menuitem'
    id: string
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'highlighted' | undefined
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'menu'
    'data-part': 'item'
    'data-value': string
    tabIndex: -1
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface MenuParts<S> {
  trigger: {
    type: 'button'
    'aria-haspopup': 'menu'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    id: string
    'data-state': (s: S) => 'open' | 'closed'
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
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'menu'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (value: string) => MenuItemParts<S>
}

export interface ConnectOptions {
  id: string
  /** Called when an item is activated (Enter/Space/click). */
  onSelect?: (value: string) => void
}

export function connect<S>(
  get: (s: S) => MenuState,
  send: Send<MenuMsg>,
  opts: ConnectOptions,
): MenuParts<S> {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const itemId = (v: string): string => `${base}:item:${v}`

  const handleMenuKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        send({ type: 'highlightNext' })
        return
      case 'ArrowUp':
        e.preventDefault()
        send({ type: 'highlightPrev' })
        return
      case 'Home':
        e.preventDefault()
        send({ type: 'highlightFirst' })
        return
      case 'End':
        e.preventDefault()
        send({ type: 'highlightLast' })
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
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          send({ type: 'typeahead', char: e.key, now: Date.now() })
        }
    }
  }

  return {
    trigger: {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      id: triggerId,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'menu',
      'data-part': 'trigger',
      onClick: () => send({ type: 'toggle' }),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          send({ type: 'open' })
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          send({ type: 'open' })
          send({ type: 'highlightLast' })
        }
      },
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
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'menu',
      'data-part': 'content',
      onKeyDown: handleMenuKey,
    },
    item: (value: string): MenuItemParts<S> => ({
      item: {
        role: 'menuitem',
        id: itemId(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        'data-state': (s) => (get(s).highlighted === value ? 'highlighted' : undefined),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'menu',
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
  get: (s: S) => MenuState
  send: Send<MenuMsg>
  parts: MenuParts<S>
  content: () => Node[]
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

  return show<S, MenuMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
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
              }),
            )

            cleanups.push(
              pushDismissable({
                element: contentEl,
                ignore: () => {
                  const t = document.getElementById(triggerId)
                  return t ? [t] : []
                },
                onDismiss: () => {
                  opts.send({ type: 'close' })
                  const t = document.getElementById(triggerId) as HTMLElement | null
                  t?.focus()
                },
              }),
            )

            // Auto-focus content so keyboard navigation works immediately.
            // preventScroll avoids a page jump when the portaled content
            // is briefly at position (0,0) before floating-ui positions it.
            contentEl.focus({ preventScroll: true })

            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [div(parts.positioner, opts.content())]
        },
      }),
    enter: opts.transition?.enter,
    leave: opts.transition?.leave,
  })
}

export const menu = { init, update, connect, overlay }
