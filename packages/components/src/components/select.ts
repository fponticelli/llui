import type { Send, Signal, TransitionOptions, Mountable, Renderable } from '@llui/dom'
import { show, portal, onMount, div, tagSend } from '@llui/dom'
import { pushDismissable } from '../utils/dismissable.js'
import { attachFloating, type Placement } from '../utils/floating.js'
import {
  typeaheadAccumulate,
  typeaheadMatchByItems,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

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
  typeahead: string
  typeaheadExpiresAt: number
}

export type SelectMsg =
  /** @intent("Open the select dropdown") */
  | { type: 'open' }
  /** @intent("Close the select dropdown") */
  | { type: 'close' }
  /** @intent("Toggle the select dropdown open/closed") */
  | { type: 'toggle' }
  /** @intent("Pick the option with the given value (toggles in multi-select)") */
  | { type: 'selectOption'; value: string }
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
    typeahead: '',
    typeaheadExpiresAt: 0,
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

export interface SelectItemParts {
  item: {
    role: 'option'
    id: string
    'aria-selected': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    'data-state': Signal<'selected' | undefined>
    'data-highlighted': Signal<'' | undefined>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'select'
    'data-part': 'item'
    'data-value': string
    'data-index': string
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
  }
}

export interface SelectParts {
  trigger: {
    type: 'button'
    role: 'combobox'
    'aria-haspopup': 'listbox'
    'aria-expanded': Signal<boolean>
    'aria-controls': string
    'aria-activedescendant': Signal<string | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'aria-required': Signal<'true' | undefined>
    id: string
    disabled: Signal<boolean>
    'data-state': Signal<'open' | 'closed'>
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
    'aria-multiselectable': Signal<'true' | undefined>
    'aria-labelledby': string
    tabIndex: -1
    'data-state': Signal<'open' | 'closed'>
    'data-scope': 'select'
    'data-part': 'content'
    onKeyDown: (e: KeyboardEvent) => void
  }
  hiddenSelect: {
    'aria-hidden': 'true'
    tabIndex: -1
    style: string
    disabled: Signal<boolean>
    multiple: Signal<boolean>
    required: Signal<boolean>
    'data-scope': 'select'
    'data-part': 'hidden-select'
  }
  item: (value: string, index: number) => SelectItemParts
  /** Selected value(s) — use for rendering the trigger label. */
  valueText: Signal<string>
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

export function connect(
  state: Signal<SelectState>,
  send: Send<SelectMsg>,
  opts: ConnectOptions,
): SelectParts {
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
      default:
        if (isTypeaheadKey(e)) {
          send({ type: 'typeahead', char: e.key, now: Date.now() })
        }
    }
  }

  return {
    trigger: {
      type: 'button',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': state.map((s) => s.open),
      'aria-controls': contentId,
      'aria-activedescendant': state.map((s) =>
        s.highlightedIndex === null ? undefined : itemId(s.highlightedIndex),
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'aria-required': state.map((s) => (s.required ? 'true' : undefined)),
      id: triggerId,
      disabled: state.map((s) => s.disabled),
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'select',
      'data-part': 'trigger',
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
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
      'aria-multiselectable': state.map((s) =>
        s.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      'aria-labelledby': triggerId,
      tabIndex: -1,
      'data-state': state.map((s) => (s.open ? 'open' : 'closed')),
      'data-scope': 'select',
      'data-part': 'content',
      onKeyDown: handleContentKey,
    },
    hiddenSelect: {
      'aria-hidden': 'true',
      tabIndex: -1,
      style: HIDDEN_STYLE,
      disabled: state.map((s) => s.disabled),
      multiple: state.map((s) => s.selectionMode === 'multiple'),
      required: state.map((s) => s.required),
      'data-scope': 'select',
      'data-part': 'hidden-select',
    },
    item: (value: string, index: number): SelectItemParts => ({
      item: {
        role: 'option',
        id: itemId(index),
        'aria-selected': state.map((s) => s.value.includes(value)),
        'aria-disabled': state.map((s) => (s.disabledItems.includes(value) ? 'true' : undefined)),
        'data-state': state.map((s) => (s.value.includes(value) ? 'selected' : undefined)),
        'data-highlighted': state.map((s) => (s.highlightedIndex === index ? '' : undefined)),
        'data-disabled': state.map((s) => (s.disabledItems.includes(value) ? '' : undefined)),
        'data-scope': 'select',
        'data-part': 'item',
        'data-value': value,
        'data-index': String(index),
        onClick: tagSend(send, ['selectOption'], () => send({ type: 'selectOption', value })),
        onPointerMove: tagSend(send, ['highlight'], () => send({ type: 'highlight', index })),
      },
    }),
    valueText: state.map((s) => {
      const v = s.value
      if (v.length === 0) return placeholder
      return v.join(separator)
    }),
  }
}

export interface OverlayOptions {
  state: Signal<SelectState>
  send: Send<SelectMsg>
  parts: SelectParts
  content: () => Renderable
  placement?: Placement
  offset?: number
  flip?: boolean
  shift?: boolean
  /** Match content width to trigger width (default: true). */
  sameWidth?: boolean
  transition?: TransitionOptions
  target?: string | HTMLElement
}

export function overlay(opts: OverlayOptions): Mountable {
  const rawTarget = opts.target ?? 'body'
  const placement = opts.placement ?? 'bottom-start'
  const offset = opts.offset ?? 4
  const flip = opts.flip !== false
  const shift = opts.shift !== false
  const sameWidth = opts.sameWidth !== false
  const parts = opts.parts
  const contentId = parts.content.id
  const triggerId = parts.trigger.id

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
                ignore: () => [triggerEl],
                onDismiss: () => {
                  opts.send({ type: 'close' })
                  triggerEl.focus()
                },
              }),
            )
            contentEl.focus({ preventScroll: true })
            return () => {
              for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
            }
          })
          return [dismissable, div(parts.positioner, opts.content())]
        }, targetEl),
      ]
    },
  )
}

export const select = { init, update, connect, overlay }
