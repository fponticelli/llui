import { tagSend } from '@llui/dom/signals'
import type { Send, Signal } from '@llui/dom/signals'
import { flipArrow } from '../utils/direction.js'

/**
 * Toggle group — a set of toggle buttons. `type: 'single'` enforces
 * one-active-at-a-time (like a radio group but visually toggles).
 * `type: 'multiple'` allows any subset to be pressed.
 */

export type Orientation = 'horizontal' | 'vertical'

export interface ToggleGroupState {
  value: string[]
  type: 'single' | 'multiple'
  items: string[]
  disabledItems: string[]
  disabled: boolean
  orientation: Orientation
  /** In single mode, whether the active item can be deselected. */
  deselectable: boolean
}

export type ToggleGroupMsg =
  /** @intent("Toggle the button with the given value (in single mode, replaces selection)") */
  | { type: 'toggle'; value: string }
  /** @intent("Replace the pressed-value set with the provided list") */
  | { type: 'setValue'; value: string[] }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @humanOnly */
  | { type: 'focusNext'; from: string }
  /** @humanOnly */
  | { type: 'focusPrev'; from: string }

export interface ToggleGroupInit {
  value?: string[]
  type?: 'single' | 'multiple'
  items?: string[]
  disabledItems?: string[]
  disabled?: boolean
  orientation?: Orientation
  deselectable?: boolean
}

export function init(opts: ToggleGroupInit = {}): ToggleGroupState {
  return {
    value: opts.value ?? [],
    type: opts.type ?? 'single',
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    disabled: opts.disabled ?? false,
    orientation: opts.orientation ?? 'horizontal',
    deselectable: opts.deselectable ?? true,
  }
}

export function update(state: ToggleGroupState, msg: ToggleGroupMsg): [ToggleGroupState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'toggle': {
      if (state.disabledItems.includes(msg.value)) return [state, []]
      const isActive = state.value.includes(msg.value)
      if (state.type === 'multiple') {
        const next = isActive
          ? state.value.filter((v) => v !== msg.value)
          : [...state.value, msg.value]
        return [{ ...state, value: next }, []]
      }
      // single
      if (isActive) {
        if (!state.deselectable) return [state, []]
        return [{ ...state, value: [] }, []]
      }
      return [{ ...state, value: [msg.value] }, []]
    }
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'setItems':
      return [
        { ...state, items: msg.items, disabledItems: msg.disabled ?? state.disabledItems },
        [],
      ]
    case 'focusNext':
    case 'focusPrev':
      return [state, []]
  }
}

export interface ToggleGroupItemParts {
  root: {
    type: 'button'
    role: 'button'
    'aria-pressed': Signal<boolean>
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-state': Signal<'on' | 'off'>
    'data-disabled': Signal<'' | undefined>
    'data-scope': 'toggle-group'
    'data-part': 'item'
    'data-value': string
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export interface ToggleGroupParts {
  root: {
    role: 'group'
    'aria-disabled': Signal<'true' | undefined>
    'data-scope': 'toggle-group'
    'data-part': 'root'
    'data-orientation': Signal<Orientation>
    'data-disabled': Signal<'' | undefined>
  }
  item: (value: string) => ToggleGroupItemParts
}

export function connect(
  state: Signal<ToggleGroupState>,
  send: Send<ToggleGroupMsg>,
): ToggleGroupParts {
  return {
    root: {
      role: 'group',
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-scope': 'toggle-group',
      'data-part': 'root',
      'data-orientation': state.map((s) => s.orientation),
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    item: (value: string): ToggleGroupItemParts => ({
      root: {
        type: 'button',
        role: 'button',
        'aria-pressed': state.map((s) => s.value.includes(value)),
        'aria-disabled': state.map((s) =>
          s.disabled || s.disabledItems.includes(value) ? 'true' : undefined,
        ),
        disabled: state.map((s) => s.disabled || s.disabledItems.includes(value)),
        'data-state': state.map((s) => (s.value.includes(value) ? 'on' : 'off')),
        'data-disabled': state.map((s) =>
          s.disabled || s.disabledItems.includes(value) ? '' : undefined,
        ),
        'data-scope': 'toggle-group',
        'data-part': 'item',
        'data-value': value,
        onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle', value })),
        onKeyDown: tagSend(send, ['focusNext', 'focusPrev', 'toggle'], (e) => {
          const key = flipArrow(e.key, e.currentTarget as Element)
          switch (key) {
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
            case ' ':
            case 'Enter':
              e.preventDefault()
              send({ type: 'toggle', value })
              return
          }
        }),
      },
    }),
  }
}

export const toggleGroup = { init, update, connect }
