import type { Send } from '@llui/dom'
import {
  typeaheadAccumulate,
  typeaheadMatchByItems,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

/**
 * Listbox — a list of selectable options. Supports single and multiple
 * selection, keyboard navigation (arrows, Home, End), typeahead, and
 * disabled items. Renders as `role="listbox"` with `role="option"` items.
 */

export type SelectionMode = 'single' | 'multiple'

export interface ListboxState {
  value: string[]
  items: string[]
  disabledItems: string[]
  disabled: boolean
  selectionMode: SelectionMode
  highlightedIndex: number | null
  typeahead: string
  typeaheadExpiresAt: number
}

export type ListboxMsg =
  /** @intent("Pick the option with the given value (toggles in multi-select)") */
  | { type: 'select'; value: string }
  /** @intent("Replace the selected values with the provided list") */
  | { type: 'setValue'; value: string[] }
  /** @intent("Clear all selected values") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'highlight'; index: number | null }
  /** @humanOnly */
  | { type: 'highlightNext' }
  /** @humanOnly */
  | { type: 'highlightPrev' }
  /** @humanOnly */
  | { type: 'highlightFirst' }
  /** @humanOnly */
  | { type: 'highlightLast' }
  /** @intent("Pick the currently-highlighted option") */
  | { type: 'selectHighlighted' }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @humanOnly */
  | { type: 'typeahead'; char: string; now: number }

export interface ListboxInit {
  value?: string[]
  items?: string[]
  disabledItems?: string[]
  disabled?: boolean
  selectionMode?: SelectionMode
}

export function init(opts: ListboxInit = {}): ListboxState {
  return {
    value: opts.value ?? [],
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    disabled: opts.disabled ?? false,
    selectionMode: opts.selectionMode ?? 'single',
    highlightedIndex: null,
    typeahead: '',
    typeaheadExpiresAt: 0,
  }
}

function nextEnabledIndex(
  items: string[],
  disabled: string[],
  from: number | null,
  delta: 1 | -1,
): number | null {
  if (items.length === 0) return null
  const start = from === null ? (delta === 1 ? -1 : items.length) : from
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const idx = (start + delta * i + n * n) % n
    if (!disabled.includes(items[idx]!)) return idx
  }
  return null
}

function firstEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = 0; i < items.length; i++) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
}

function lastEnabledIndex(items: string[], disabled: string[]): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!disabled.includes(items[i]!)) return i
  }
  return null
}

function applySelection(state: ListboxState, value: string): string[] {
  if (state.disabledItems.includes(value)) return state.value
  if (state.selectionMode === 'single') return [value]
  // multiple
  const isActive = state.value.includes(value)
  return isActive ? state.value.filter((v) => v !== value) : [...state.value, value]
}

export function update(state: ListboxState, msg: ListboxMsg): [ListboxState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'select':
      return [{ ...state, value: applySelection(state, msg.value) }, []]
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [{ ...state, value: [] }, []]
    case 'highlight':
      return [{ ...state, highlightedIndex: msg.index }, []]
    case 'highlightNext': {
      const to = nextEnabledIndex(state.items, state.disabledItems, state.highlightedIndex, 1)
      return [{ ...state, highlightedIndex: to }, []]
    }
    case 'highlightPrev': {
      const to = nextEnabledIndex(state.items, state.disabledItems, state.highlightedIndex, -1)
      return [{ ...state, highlightedIndex: to }, []]
    }
    case 'highlightFirst':
      return [
        { ...state, highlightedIndex: firstEnabledIndex(state.items, state.disabledItems) },
        [],
      ]
    case 'highlightLast':
      return [
        { ...state, highlightedIndex: lastEnabledIndex(state.items, state.disabledItems) },
        [],
      ]
    case 'selectHighlighted': {
      if (state.highlightedIndex === null) return [state, []]
      const v = state.items[state.highlightedIndex]
      if (v === undefined) return [state, []]
      return [{ ...state, value: applySelection(state, v) }, []]
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      // Preserve only values still in the items list and not disabled
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      return [{ ...state, items: msg.items, disabledItems: disabled, value }, []]
    }
    case 'typeahead': {
      const acc = typeaheadAccumulate(state.typeahead, msg.char, msg.now, state.typeaheadExpiresAt)
      const match = typeaheadMatchByItems(
        state.items,
        state.disabledItems,
        acc,
        state.highlightedIndex,
      )
      return [
        {
          ...state,
          typeahead: acc,
          typeaheadExpiresAt: msg.now + TYPEAHEAD_TIMEOUT_MS,
          highlightedIndex: match ?? state.highlightedIndex,
        },
        [],
      ]
    }
  }
}

export interface ListboxItemParts<S> {
  root: {
    role: 'option'
    id: string
    'aria-selected': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'selected' | undefined
    'data-highlighted': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'listbox'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ListboxParts<S> {
  root: {
    role: 'listbox'
    'aria-owns': (s: S) => string | undefined
    'aria-multiselectable': (s: S) => 'true' | undefined
    'aria-disabled': (s: S) => 'true' | undefined
    'aria-activedescendant': (s: S) => string | undefined
    tabIndex: (s: S) => number
    id: string
    'data-scope': 'listbox'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (value: string, index: number) => ListboxItemParts<S>
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => ListboxState,
  send: Send<ListboxMsg>,
  opts: ConnectOptions,
): ListboxParts<S> {
  const rootId = `${opts.id}:root`
  const itemId = (index: number): string => `${opts.id}:item:${index}`

  return {
    root: {
      role: 'listbox',
      'aria-owns': (s) => {
        const items = get(s).items
        if (items.length === 0) return undefined
        return items.map((_, i) => itemId(i)).join(' ')
      },
      'aria-multiselectable': (s) => (get(s).selectionMode === 'multiple' ? 'true' : undefined),
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'aria-activedescendant': (s) => {
        const idx = get(s).highlightedIndex
        return idx === null ? undefined : itemId(idx)
      },
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      id: rootId,
      'data-scope': 'listbox',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
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
          default:
            if (isTypeaheadKey(e)) {
              send({ type: 'typeahead', char: e.key, now: Date.now() })
            }
        }
      },
    },
    item: (value: string, index: number): ListboxItemParts<S> => ({
      root: {
        role: 'option',
        id: itemId(index),
        'aria-selected': (s) => get(s).value.includes(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        'data-state': (s) => (get(s).value.includes(value) ? 'selected' : undefined),
        'data-highlighted': (s) => (get(s).highlightedIndex === index ? '' : undefined),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'listbox',
        'data-part': 'item',
        'data-value': value,
        'data-index': String(index),
        onClick: () => send({ type: 'select', value }),
        onPointerMove: () => send({ type: 'highlight', index }),
      },
    }),
  }
}

export const listbox = { init, update, connect }
