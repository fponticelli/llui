import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction'

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
  | { type: 'toggle'; value: string }
  | { type: 'setValue'; value: string[] }
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  | { type: 'focusNext'; from: string }
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

export interface ToggleGroupItemParts<S> {
  root: {
    type: 'button'
    role: 'button'
    'aria-pressed': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    disabled: (s: S) => boolean
    'data-state': (s: S) => 'on' | 'off'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'toggle-group'
    'data-part': 'item'
    'data-value': string
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export interface ToggleGroupParts<S> {
  root: {
    role: 'group'
    'aria-orientation': (s: S) => Orientation
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'toggle-group'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
    'data-disabled': (s: S) => '' | undefined
  }
  item: (value: string) => ToggleGroupItemParts<S>
}

export function connect<S>(
  get: (s: S) => ToggleGroupState,
  send: Send<ToggleGroupMsg>,
): ToggleGroupParts<S> {
  return {
    root: {
      role: 'group',
      'aria-orientation': (s) => get(s).orientation,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'toggle-group',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    item: (value: string): ToggleGroupItemParts<S> => ({
      root: {
        type: 'button',
        role: 'button',
        'aria-pressed': (s) => get(s).value.includes(value),
        'aria-disabled': (s) =>
          get(s).disabled || get(s).disabledItems.includes(value) ? 'true' : undefined,
        disabled: (s) => get(s).disabled || get(s).disabledItems.includes(value),
        'data-state': (s) => (get(s).value.includes(value) ? 'on' : 'off'),
        'data-disabled': (s) =>
          get(s).disabled || get(s).disabledItems.includes(value) ? '' : undefined,
        'data-scope': 'toggle-group',
        'data-part': 'item',
        'data-value': value,
        onClick: () => send({ type: 'toggle', value }),
        onKeyDown: (e) => {
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
        },
      },
    }),
  }
}

export const toggleGroup = { init, update, connect }
