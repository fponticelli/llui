import type { Send, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable'
import { attachFloating, type Placement } from '../utils/floating'

/**
 * Select — a trigger button that opens a listbox dropdown. Value(s) are
 * visible on the trigger. Supports single or multiple selection.
 * Positioned relative to the trigger via `@floating-ui/dom`.
 */

export type SelectionMode = 'single' | 'multiple'

export interface SelectState {
  open: boolean
  value: string[]
  items: string[]
  disabledItems: string[]
  selectionMode: SelectionMode
  highlightedIndex: number | null
  disabled: boolean
  required: boolean
}

export type SelectMsg =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'selectOption'; value: string }
  | { type: 'setValue'; value: string[] }
  | { type: 'clear' }
  | { type: 'highlight'; index: number | null }
  | { type: 'highlightNext' }
  | { type: 'highlightPrev' }
  | { type: 'highlightFirst' }
  | { type: 'highlightLast' }
  | { type: 'selectHighlighted' }
  | { type: 'setItems'; items: string[]; disabled?: string[] }

export interface SelectInit {
  value?: string[]
  items?: string[]
  disabledItems?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  required?: boolean
}

export function init(opts: SelectInit = {}): SelectState {
  return {
    open: false,
    value: opts.value ?? [],
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    selectionMode: opts.selectionMode ?? 'single',
    highlightedIndex: null,
    disabled: opts.disabled ?? false,
    required: opts.required ?? false,
  }
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

function applySelection(state: SelectState, value: string): string[] {
  if (state.disabledItems.includes(value)) return state.value
  if (state.selectionMode === 'single') return [value]
  const isActive = state.value.includes(value)
  return isActive ? state.value.filter((v) => v !== value) : [...state.value, value]
}

/** Index of the first selected item, or null. */
function firstSelectedIndex(state: SelectState): number | null {
  if (state.value.length === 0) return null
  const idx = state.items.indexOf(state.value[0]!)
  return idx === -1 ? null : idx
}

export function update(state: SelectState, msg: SelectMsg): [SelectState, never[]] {
  if (state.disabled && msg.type !== 'setItems') return [state, []]
  switch (msg.type) {
    case 'open': {
      const highlightedIndex =
        firstSelectedIndex(state) ?? firstEnabledIndex(state.items, state.disabledItems)
      return [{ ...state, open: true, highlightedIndex }, []]
    }
    case 'close':
      return [{ ...state, open: false, highlightedIndex: null }, []]
    case 'toggle':
      return state.open
        ? [{ ...state, open: false, highlightedIndex: null }, []]
        : [
            {
              ...state,
              open: true,
              highlightedIndex:
                firstSelectedIndex(state) ?? firstEnabledIndex(state.items, state.disabledItems),
            },
            [],
          ]
    case 'selectOption': {
      const value = applySelection(state, msg.value)
      // Single mode closes on selection; multi stays open
      const open = state.selectionMode === 'single' ? false : state.open
      const highlightedIndex = open ? state.highlightedIndex : null
      return [{ ...state, value, open, highlightedIndex }, []]
    }
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [{ ...state, value: [] }, []]
    case 'highlight':
      return [{ ...state, highlightedIndex: msg.index }, []]
    case 'highlightNext':
      return [
        {
          ...state,
          highlightedIndex: nextEnabledIndex(
            state.items,
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
            state.items,
            state.disabledItems,
            state.highlightedIndex,
            -1,
          ),
        },
        [],
      ]
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
      const value = applySelection(state, v)
      const open = state.selectionMode === 'single' ? false : state.open
      return [{ ...state, value, open, highlightedIndex: open ? state.highlightedIndex : null }, []]
    }
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value = state.value.filter((v) => msg.items.includes(v) && !disabled.includes(v))
      return [{ ...state, items: msg.items, disabledItems: disabled, value }, []]
    }
  }
}

export interface SelectItemParts<S> {
  item: {
    role: 'option'
    id: string
    'aria-selected': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'selected' | undefined
    'data-highlighted': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'select'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface SelectParts<S> {
  trigger: {
    type: 'button'
    role: 'combobox'
    'aria-haspopup': 'listbox'
    'aria-expanded': (s: S) => boolean
    'aria-controls': string
    'aria-activedescendant': (s: S) => string | undefined
    'aria-disabled': (s: S) => 'true' | undefined
    'aria-required': (s: S) => 'true' | undefined
    id: string
    disabled: (s: S) => boolean
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'select'
    'data-part': 'trigger'
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  positioner: {
    'data-scope': 'select'
    'data-part': 'positioner'
    style: string
  }
  content: {
    role: 'listbox'
    id: string
    'aria-multiselectable': (s: S) => 'true' | undefined
    'aria-labelledby': string
    tabIndex: -1
    'data-state': (s: S) => 'open' | 'closed'
    'data-scope': 'select'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  hiddenSelect: {
    'aria-hidden': 'true'
    tabIndex: -1
    style: string
    disabled: (s: S) => boolean
    multiple: (s: S) => boolean
    required: (s: S) => boolean
    'data-scope': 'select'
    'data-part': 'hidden-select'
  }
  item: (value: string, index: number) => SelectItemParts<S>
  /** Selected value(s) — use for rendering the trigger label. */
  valueText: (s: S) => string
}

export interface ConnectOptions {
  id: string
  /** Text to show in trigger when empty. */
  placeholder?: string
  /** Join multi-value labels with this separator. */
  separator?: string
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'

export function connect<S>(
  get: (s: S) => SelectState,
  send: Send<SelectMsg>,
  opts: ConnectOptions,
): SelectParts<S> {
  const base = opts.id
  const triggerId = `${base}:trigger`
  const contentId = `${base}:content`
  const itemId = (index: number): string => `${base}:item:${index}`
  const placeholder = opts.placeholder ?? ''
  const separator = opts.separator ?? ', '

  const handleTriggerKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        e.preventDefault()
        send({ type: 'open' })
        return
      case 'ArrowUp':
        e.preventDefault()
        send({ type: 'open' })
        send({ type: 'highlightLast' })
        return
    }
  }

  const handleContentKey = (e: KeyboardEvent): void => {
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
    }
  }

  return {
    trigger: {
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': (s) => get(s).open,
      'aria-controls': contentId,
      'aria-activedescendant': (s) => {
        const idx = get(s).highlightedIndex
        return idx === null ? undefined : itemId(idx)
      },
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'aria-required': (s) => (get(s).required ? 'true' : undefined),
      id: triggerId,
      disabled: (s) => get(s).disabled,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'select',
      'data-part': 'trigger',
      onClick: () => send({ type: 'toggle' }),
      onKeyDown: handleTriggerKey,
    },
    positioner: {
      'data-scope': 'select',
      'data-part': 'positioner',
      style: 'position:absolute;top:0;left:0;',
    },
    content: {
      role: 'listbox',
      id: contentId,
      'aria-multiselectable': (s) => (get(s).selectionMode === 'multiple' ? 'true' : undefined),
      'aria-labelledby': triggerId,
      tabIndex: -1,
      'data-state': (s) => (get(s).open ? 'open' : 'closed'),
      'data-scope': 'select',
      'data-part': 'content',
      onKeyDown: handleContentKey,
    },
    hiddenSelect: {
      'aria-hidden': 'true',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      disabled: (s) => get(s).disabled,
      multiple: (s) => get(s).selectionMode === 'multiple',
      required: (s) => get(s).required,
      'data-scope': 'select',
      'data-part': 'hidden-select',
    },
    item: (value: string, index: number): SelectItemParts<S> => ({
      item: {
        role: 'option',
        id: itemId(index),
        'aria-selected': (s) => get(s).value.includes(value),
        'aria-disabled': (s) => (get(s).disabledItems.includes(value) ? 'true' : undefined),
        'data-state': (s) => (get(s).value.includes(value) ? 'selected' : undefined),
        'data-highlighted': (s) => (get(s).highlightedIndex === index ? '' : undefined),
        'data-disabled': (s) => (get(s).disabledItems.includes(value) ? '' : undefined),
        'data-scope': 'select',
        'data-part': 'item',
        'data-value': value,
        'data-index': String(index),
        onClick: () => send({ type: 'selectOption', value }),
        onPointerMove: () => send({ type: 'highlight', index }),
      },
    }),
    valueText: (s) => {
      const v = get(s).value
      if (v.length === 0) return placeholder
      return v.join(separator)
    },
  }
}

export interface OverlayOptions<S> {
  get: (s: S) => SelectState
  send: Send<SelectMsg>
  parts: SelectParts<S>
  content: () => Node[]
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  /** Match content width to trigger width (default: true). */
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
  const triggerId = parts.trigger.id

  return show<S, SelectMsg>({
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
            if (sameWidth) {
              floatingEl.style.minWidth = `${triggerEl.offsetWidth}px`
            }
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
            contentEl.focus()
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

export const select = { init, update, connect, overlay }
