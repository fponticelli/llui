import type { Send } from '@llui/dom'

/**
 * Tabs — tabbed interface with keyboard navigation. Each tab has a value
 * (string) that identifies both the trigger and the associated panel.
 *
 * Two activation modes:
 *   - `'automatic'` (default): focusing a trigger also activates it.
 *   - `'manual'`: arrow keys move focus without activating; Enter/Space activates.
 */

export type Orientation = 'horizontal' | 'vertical'
export type Activation = 'automatic' | 'manual'

export interface TabsState {
  value: string
  items: string[]
  disabledItems: string[]
  orientation: Orientation
  activation: Activation
  /** The currently focused (but not necessarily active) tab. For manual mode. */
  focused: string | null
}

export type TabsMsg =
  | { type: 'setValue'; value: string }
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  | { type: 'focusTab'; value: string }
  | { type: 'focusNext'; from: string }
  | { type: 'focusPrev'; from: string }
  | { type: 'focusFirst' }
  | { type: 'focusLast' }
  | { type: 'activateFocused' }

export interface TabsInit {
  value?: string
  items?: string[]
  disabledItems?: string[]
  orientation?: Orientation
  activation?: Activation
}

export function init(opts: TabsInit = {}): TabsState {
  const items = opts.items ?? []
  return {
    value: opts.value ?? items[0] ?? '',
    items,
    disabledItems: opts.disabledItems ?? [],
    orientation: opts.orientation ?? 'horizontal',
    activation: opts.activation ?? 'automatic',
    focused: null,
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

function nextEnabled(items: string[], disabled: string[], from: string, delta: 1 | -1): string | null {
  if (items.length === 0) return null
  const idx = items.indexOf(from)
  if (idx === -1) return firstEnabled(items, disabled)
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const next = items[(idx + delta * i + n * n) % n]!
    if (!disabled.includes(next)) return next
  }
  return null
}

export function update(state: TabsState, msg: TabsMsg): [TabsState, never[]] {
  switch (msg.type) {
    case 'setValue':
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, value: msg.value }, []]
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      // Ensure value still points to an existing enabled item
      let value = state.value
      if (!msg.items.includes(value) || disabled.includes(value)) {
        value = firstEnabled(msg.items, disabled) ?? ''
      }
      return [{ ...state, items: msg.items, disabledItems: disabled, value }, []]
    }
    case 'focusTab': {
      if (state.disabledItems.includes(msg.value)) return [state, []]
      const next: TabsState = { ...state, focused: msg.value }
      if (state.activation === 'automatic') next.value = msg.value
      return [next, []]
    }
    case 'focusNext': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, 1)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusPrev': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, -1)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusFirst': {
      const to = firstEnabled(state.items, state.disabledItems)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'focusLast': {
      const to = lastEnabled(state.items, state.disabledItems)
      if (to === null) return [state, []]
      const next: TabsState = { ...state, focused: to }
      if (state.activation === 'automatic') next.value = to
      return [next, []]
    }
    case 'activateFocused': {
      if (state.focused === null) return [state, []]
      return [{ ...state, value: state.focused }, []]
    }
  }
}

export interface TabsItemParts<S> {
  trigger: {
    type: 'button'
    role: 'tab'
    'aria-selected': (s: S) => boolean
    'aria-controls': string
    'aria-disabled': (s: S) => 'true' | undefined
    id: string
    'data-state': (s: S) => 'active' | 'inactive'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'tabs'
    'data-part': 'trigger'
    'data-value': string
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  panel: {
    role: 'tabpanel'
    id: string
    'aria-labelledby': string
    tabIndex: 0
    hidden: (s: S) => boolean
    'data-state': (s: S) => 'active' | 'inactive'
    'data-scope': 'tabs'
    'data-part': 'panel'
    'data-value': string
  }
}

export interface TabsParts<S> {
  root: {
    'data-scope': 'tabs'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
  }
  list: {
    role: 'tablist'
    'aria-orientation': (s: S) => Orientation
    'data-scope': 'tabs'
    'data-part': 'list'
  }
  item: (value: string) => TabsItemParts<S>
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => TabsState,
  send: Send<TabsMsg>,
  opts: ConnectOptions,
): TabsParts<S> {
  const base = opts.id
  const triggerId = (v: string): string => `${base}:trigger:${v}`
  const panelId = (v: string): string => `${base}:panel:${v}`

  return {
    root: {
      'data-scope': 'tabs',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
    },
    list: {
      role: 'tablist',
      'aria-orientation': (s) => get(s).orientation,
      'data-scope': 'tabs',
      'data-part': 'list',
    },
    item: (value: string): TabsItemParts<S> => ({
      trigger: {
        type: 'button',
        role: 'tab',
        'aria-selected': (s) => get(s).value === value,
        'aria-controls': panelId(value),
        'aria-disabled': (s) =>
          get(s).disabledItems.includes(value) ? 'true' : undefined,
        id: triggerId(value),
        'data-state': (s) => (get(s).value === value ? 'active' : 'inactive'),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'tabs',
        'data-part': 'trigger',
        'data-value': value,
        tabIndex: (s) => (get(s).value === value ? 0 : -1),
        onClick: () => send({ type: 'focusTab', value }),
        onFocus: () => {
          // `focusTab` handles automatic activation
          send({ type: 'focusTab', value })
        },
        onKeyDown: (e: KeyboardEvent) => {
          const state = (e.currentTarget as HTMLElement | null)?.dataset
          void state
          // Need orientation — but we don't have state here. Fall back to both axes.
          switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'focusNext', from: value })
              return
            case 'ArrowLeft':
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'focusPrev', from: value })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'focusFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'focusLast' })
              return
            case 'Enter':
            case ' ':
              e.preventDefault()
              send({ type: 'activateFocused' })
              return
          }
        },
      },
      panel: {
        role: 'tabpanel',
        id: panelId(value),
        'aria-labelledby': triggerId(value),
        tabIndex: 0,
        hidden: (s) => get(s).value !== value,
        'data-state': (s) => (get(s).value === value ? 'active' : 'inactive'),
        'data-scope': 'tabs',
        'data-part': 'panel',
        'data-value': value,
      },
    }),
  }
}

export const tabs = { init, update, connect }
