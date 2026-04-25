import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div, useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'
import { pushDismissable } from '../utils/dismissable.js'
import { attachFloating, type Placement } from '../utils/floating.js'

/**
 * Combobox — text input paired with a filtered listbox dropdown. User
 * types to filter items, arrow keys navigate the filtered set, Enter
 * selects. Supports single and multiple selection.
 */

export type SelectionMode = 'single' | 'multiple'

export interface ComboboxState {
  open: boolean
  value: string[]
  inputValue: string
  items: string[]
  disabledItems: string[]
  filteredItems: string[]
  highlightedIndex: number | null
  selectionMode: SelectionMode
  disabled: boolean
}

export type ComboboxMsg =
  /** @intent("Open") */
  | { type: 'open' }
  /** @intent("Close") */
  | { type: 'close' }
  /** @intent("Set Input Value") */
  | { type: 'setInputValue'; value: string }
  /** @intent("Select Option") */
  | { type: 'selectOption'; value: string }
  /** @intent("Set Value") */
  | { type: 'setValue'; value: string[] }
  /** @intent("Clear") */
  | { type: 'clear' }
  /** @humanOnly */
  | { type: 'highlightNext' }
  /** @humanOnly */
  | { type: 'highlightPrev' }
  /** @humanOnly */
  | { type: 'highlightFirst' }
  /** @humanOnly */
  | { type: 'highlightLast' }
  /** @humanOnly */
  | { type: 'highlight'; index: number | null }
  /** @intent("Select Highlighted") */
  | { type: 'selectHighlighted' }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }

export interface ComboboxInit {
  value?: string[]
  inputValue?: string
  items?: string[]
  disabledItems?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
}

export function init(opts: ComboboxInit = {}): ComboboxState {
  const items = opts.items ?? []
  const disabledItems = opts.disabledItems ?? []
  const inputValue = opts.inputValue ?? ''
  return {
    open: false,
    value: opts.value ?? [],
    inputValue,
    items,
    disabledItems,
    filteredItems: filterItems(items, inputValue),
    highlightedIndex: null,
    selectionMode: opts.selectionMode ?? 'single',
    disabled: opts.disabled ?? false,
  }
}

function filterItems(items: string[], query: string): string[] {
  if (query === '') return items
  const q = query.toLowerCase()
  return items.filter((item) => item.toLowerCase().includes(q))
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

function applySelection(state: ComboboxState, value: string): string[] {
  if (state.disabledItems.includes(value)) return state.value
  if (state.selectionMode === 'single') return [value]
  const isActive = state.value.includes(value)
  return isActive ? state.value.filter((v) => v !== value) : [...state.value, value]
}

export function update(state: ComboboxState, msg: ComboboxMsg): [ComboboxState, never[]] {
  if (state.disabled && msg.type !== 'setItems') return [state, []]
  switch (msg.type) {
    case 'open':
      return [
        {
          ...state,
          open: true,
          highlightedIndex: firstEnabledIndex(state.filteredItems, state.disabledItems),
        },
        [],
      ]
    case 'close':
      return [{ ...state, open: false, highlightedIndex: null }, []]
    case 'setInputValue': {
      const filteredItems = filterItems(state.items, msg.value)
      return [
        {
          ...state,
          inputValue: msg.value,
          filteredItems,
          open: true,
          highlightedIndex: firstEnabledIndex(filteredItems, state.disabledItems),
        },
        [],
      ]
    }
    case 'selectOption': {
      const value = applySelection(state, msg.value)
      const inputValue = state.selectionMode === 'single' ? msg.value : ''
      const filteredItems = filterItems(state.items, inputValue)
      const open = state.selectionMode === 'single' ? false : state.open
      return [
        {
          ...state,
          value,
          inputValue,
          filteredItems,
          open,
          highlightedIndex: open ? state.highlightedIndex : null,
        },
        [],
      ]
    }
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [
        { ...state, value: [], inputValue: '', filteredItems: state.items, highlightedIndex: null },
        [],
      ]
    case 'highlight':
      return [{ ...state, highlightedIndex: msg.index }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlightedIndex: nextEnabledIndex(
            state.filteredItems,
            state.disabledItems,
            state.highlightedIndex,
            1,
          ),
        },
        [],
      ]
    case 'highlightPrev':
      return [
        {
          ...state,
          highlightedIndex: nextEnabledIndex(
            state.filteredItems,
            state.disabledItems,
            state.highlightedIndex,
            -1,
          ),
        },
        [],
      ]
    case 'highlightFirst':
      return [
        { ...state, highlightedIndex: firstEnabledIndex(state.filteredItems, state.disabledItems) },
        [],
      ]
    case 'highlightLast':
      return [
        { ...state, highlightedIndex: lastEnabledIndex(state.filteredItems, state.disabledItems) },
        [],
      ]
    case 'selectHighlighted': {
      if (state.highlightedIndex === null) return [state, []]
      const v = state.filteredItems[state.highlightedIndex]
      if (v === undefined) return [state, []]
      const value = applySelection(state, v)
      const inputValue = state.selectionMode === 'single' ? v : ''
      const filteredItems = filterItems(state.items, inputValue)
      const open = state.selectionMode === 'single' ? false : state.open
      return [
        {
          ...state,
          value,
          inputValue,
          filteredItems,
          open,
          highlightedIndex: open ? state.highlightedIndex : null,
        },
        [],
      ]
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      return [
        {
          ...state,
          items: msg.items,
          disabledItems: disabled,
          filteredItems: filterItems(msg.items, state.inputValue),
          value,
        },
        [],
      ]
    }
  }
}

export interface ComboboxItemParts<S> {
  item: {
    role: 'option'
    id: string
    'aria-selected': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'selected' | undefined
    'data-highlighted': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'combobox'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface ComboboxParts<S> {
  root: {
    role: 'combobox'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    'aria-haspopup': 'listbox'
    'data-scope': 'combobox'
    'data-part': 'root'
    'data-state': (s: S) => 'open' | 'closed'
  }
  input: {
    type: 'text'
    role: 'combobox'
    autoComplete: 'off'
    'aria-autocomplete': 'list'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    'aria-activedescendant': (s: S) => string | undefined
    'aria-disabled': (s: S) => 'true' | undefined
    id: string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'combobox'
    'data-part': 'input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  trigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    tabIndex: -1
    'data-scope': 'combobox'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
  }
  positioner: {
    'data-scope': 'combobox'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'listbox'
    id: string
    'aria-labelledby': string
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'combobox'
    'data-part': 'content'
  }
  item: (value: string, index: number) => ComboboxItemParts<S>
  empty: {
    'data-scope': 'combobox'
    'data-part': 'empty'
  }
}

export interface ConnectOptions {
  id: string
  triggerLabel?: string
}

export function connect<S>(
  get: (s: S) => ComboboxState,
  send: Send<ComboboxMsg>,
  opts: ConnectOptions,
): ComboboxParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const base = opts.id
  const inputId = `${base}:input`
  const contentId = `${base}:content`
  const itemId = (index: number): string => `${base}:item:${index}`
  const triggerLabel: string | ((s: S) => string) =
    opts.triggerLabel ?? ((s: S) => locale(s).combobox.toggle)

  return {
    root: {
      role: 'combobox',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      'aria-haspopup': 'listbox',
      'data-scope': 'combobox',
      'data-part': 'root',
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
    },
    input: {
      type: 'text',
      role: 'combobox',
      autoComplete: 'off',
      'aria-autocomplete': 'list',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      'aria-activedescendant': (s) => {
        const idx = get(s).highlightedIndex
        return idx === null ? undefined : itemId(idx)
      },
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      id: inputId,
      disabled: (s) => get(s).disabled,
      value: (s) => get(s).inputValue,
      'data-scope': 'combobox',
      'data-part': 'input',
      onInput: (e) => {
        const value = (e.target as HTMLInputElement).value
        send({ type: 'setInputValue', value })
      },
      onKeyDown: (e) => {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            send({ type: 'open' })
            send({ type: 'highlightNext' })
            return
          case 'ArrowUp':
            e.preventDefault()
            send({ type: 'open' })
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
            e.preventDefault()
            send({ type: 'selectHighlighted' })
            return
          case 'Escape':
            e.preventDefault()
            send({ type: 'close' })
            return
        }
      },
      onFocus: () => send({ type: 'open' }),
    },
    trigger: {
      type: 'button',
      'aria-label': triggerLabel,
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      tabIndex: -1,
      'data-scope': 'combobox',
      'data-part': 'trigger',
      onClick: () => send({ type: 'open' }),
    },
    positioner: {
      'data-scope': 'combobox',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'listbox',
      id: contentId,
      'aria-labelledby': inputId,
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'combobox',
      'data-part': 'content',
    },
    item: (value: string, index: number): ComboboxItemParts<S> => ({
      item: {
        role: 'option',
        id: itemId(index),
        'aria-selected': (s) => get(s).value.includes(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        'data-state': (s) => (get(s).value.includes(value) ? 'selected' : undefined),
        'data-highlighted': (s) => (get(s).highlightedIndex === index ? '' : undefined),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'combobox',
        'data-part': 'item',
        'data-value': value,
        'data-index': String(index),
        onClick: () => send({ type: 'selectOption', value }),
        onPointerMove: () => send({ type: 'highlight', index }),
      },
    }),
    empty: {
      'data-scope': 'combobox',
      'data-part': 'empty',
    },
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => ComboboxState
  send: Send<ComboboxMsg>
  parts: ComboboxParts<S>
  content: () => Node[]
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  sameWidth?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay<S>(opts: OverlayOptions<S>): Node[] {
  const target = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const sameWidth = opts.sameWidth !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const inputId = parts.input.id

  return show<S, ComboboxMsg>({
    when: (s) => opts.get(s).open,
    render: () =>
      portal({
        target,
        render: () => {
          onMount(() => {
            const contentEl = document.getElementById(contentId)
            const inputEl = document.getElementById(inputId)
            if (!contentEl || !inputEl) return

            const cleanups: Array<() => void> = []
            const positioner = contentEl.closest('[data-part="positioner"]') as HTMLElement | null
            const floatingEl = positioner ?? contentEl
            if (sameWidth) {
              floatingEl.style.minWidth = `${inputEl.offsetWidth}px`
            }
            cleanups.push(
              attachFloating({
                anchor: inputEl,
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
                ignore: () => [inputEl],
                onDismiss: () => opts.send({ type: 'close' }),
              }),
            )
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

export const combobox = { init, update, connect, overlay }
