import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
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

export interface ListboxItemParts {
  root: {
    role: 'option'
    id: string
    'aria-selected': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'selected' | undefined>
    'data-highlighted': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'listbox'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ListboxParts {
  root: {
    role: 'listbox'
    'aria-owns': Signal<string | undefined>
    'aria-multiselectable': Signal<'true' | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'aria-activedescendant': Signal<string | undefined>
    tabindex: Signal<number>
    id: string
    'data-scope': 'listbox'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (value: string, index: number) => ListboxItemParts
}

export interface ConnectOptions {
  id: string
}

export function connect(
  state: Signal<ListboxState>,
  send: Send<ListboxMsg>,
  opts: ConnectOptions,
): ListboxParts {
  const rootId = `${opts.id}:root`
  const itemId = (index: number): string => `${opts.id}:item:${index}`

  return {
    root: {
      role: 'listbox',
      'aria-owns': state.map((s) => {
        const items = s.items
        if (items.length === 0) return undefined
        return items.map((_, i) => itemId(i)).join(' ')
      }),
      'aria-multiselectable': state.map((s) =>
        s.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'aria-activedescendant': state.map((s) => {
        const idx = s.highlightedIndex
        return idx === null ? undefined : itemId(idx)
      }),
      tabindex: state.map((s) => (s.disabled ? -1 : 0)),
      id: rootId,
      'data-scope': 'listbox',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
      onKeyDown: tagSend(
        send,
        [
          'highlightNext',
          'highlightPrev',
          'highlightFirst',
          'highlightLast',
          'selectHighlighted',
          'typeahead',
        ],
        (e) => {
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
      ),
    },
    item: (value: string, index: number): ListboxItemParts => ({
      root: {
        role: 'option',
        id: itemId(index),
        'aria-selected': state.map((s) => s.value.includes(value)),
        'aria-disabled': state.map((s) => (s.disabledItems.includes(value) ? 'true' : undefined)),
        'data-state': state.map((s) => (s.value.includes(value) ? 'selected' : undefined)),
        'data-highlighted': state.map((s) => (s.highlightedIndex === index ? '' : undefined)),
        'data-disabled': state.map((s) => (s.disabledItems.includes(value) ? '' : undefined)),
        'data-scope': 'listbox',
        'data-part': 'item',
        'data-value': value,
        'data-index': String(index),
        onClick: tagSend(send, ['select'], () => send({ type: 'select', value })),
        onPointerMove: tagSend(send, ['highlight'], () => send({ type: 'highlight', index })),
      },
    }),
  }
}

export const listbox = { init, update, connect }
