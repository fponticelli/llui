import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import { firstEnabled, nextEnabled } from '../utils/roving.js'

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
  /** The currently roving-focused item (independent of the pressed value). */
  focused: string | null
  /** Whether Arrow navigation wraps at the ends of the group. Default: true. */
  loopFocus: boolean
  /** Reading direction. Under 'rtl', ArrowLeft/ArrowRight swap meaning. */
  dir: 'ltr' | 'rtl'
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
  /** @humanOnly */
  | { type: 'focusItem'; value: string }
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: 'ltr' | 'rtl' }

export interface ToggleGroupInit {
  value?: string[]
  type?: 'single' | 'multiple'
  items?: string[]
  disabledItems?: string[]
  disabled?: boolean
  orientation?: Orientation
  deselectable?: boolean
  focused?: string | null
  loopFocus?: boolean
  dir?: 'ltr' | 'rtl'
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
    focused: opts.focused ?? null,
    loopFocus: opts.loopFocus ?? true,
    dir: opts.dir ?? 'ltr',
  }
}

export function update(state: ToggleGroupState, msg: ToggleGroupMsg): [ToggleGroupState, never[]] {
  if (msg.type === 'setDir') return [{ ...state, dir: msg.dir }, []]
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
    case 'focusItem': {
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, focused: msg.value }, []]
    }
    case 'focusNext': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, 1, state.loopFocus)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
    case 'focusPrev': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, -1, state.loopFocus)
      return to === null ? [state, []] : [{ ...state, focused: to }, []]
    }
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
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
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
        // Roving tabindex: exactly one tab stop. Prefer the focused item;
        // else the first selected item; else the first enabled item.
        tabindex: state.map((s) => {
          if (s.disabled || s.disabledItems.includes(value)) return -1
          if (s.focused !== null) return s.focused === value ? 0 : -1
          const selected = s.items.find((v) => s.value.includes(v) && !s.disabledItems.includes(v))
          if (selected != null) return selected === value ? 0 : -1
          return firstEnabled(s.items, s.disabledItems) === value ? 0 : -1
        }),
        onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle', value })),
        onFocus: tagSend(send, ['focusItem'], () => send({ type: 'focusItem', value })),
        onKeyDown: tagSend(send, ['focusNext', 'focusPrev', 'toggle'], (e) => {
          // Read orientation from the ancestor root so arrow keys map per
          // WAI-ARIA: horizontal → ArrowLeft/Right, vertical → ArrowUp/Down.
          const target = e.currentTarget as HTMLElement | null
          const root = target?.closest(
            '[data-scope="toggle-group"][data-part="root"]',
          ) as HTMLElement | null
          const orientation =
            (root?.getAttribute('data-orientation') as Orientation | null) ?? 'horizontal'
          const key = flipArrow(e.key, state.peek().dir)
          const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
          const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
          switch (key) {
            case nextKey:
              e.preventDefault()
              send({ type: 'focusNext', from: value })
              return
            case prevKey:
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
