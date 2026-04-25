import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'

/**
 * Radio group — a set of mutually-exclusive options. Users select one value
 * at a time. Supports keyboard arrow navigation and disabled items.
 */

export type Orientation = 'horizontal' | 'vertical'

export interface RadioGroupState {
  value: string | null
  items: string[]
  disabledItems: string[]
  disabled: boolean
  orientation: Orientation
}

export type RadioGroupMsg =
  /** @intent("Set Value") */
  | { type: 'setValue'; value: string }
  /** @humanOnly */
  | { type: 'setItems'; items: string[]; disabled?: string[] }
  /** @intent("Select Next") */
  | { type: 'selectNext'; from: string }
  /** @intent("Select Prev") */
  | { type: 'selectPrev'; from: string }
  /** @intent("Select First") */
  | { type: 'selectFirst' }
  /** @intent("Select Last") */
  | { type: 'selectLast' }

export interface RadioGroupInit {
  value?: string | null
  items?: string[]
  disabledItems?: string[]
  disabled?: boolean
  orientation?: Orientation
}

export function init(opts: RadioGroupInit = {}): RadioGroupState {
  return {
    value: opts.value ?? null,
    items: opts.items ?? [],
    disabledItems: opts.disabledItems ?? [],
    disabled: opts.disabled ?? false,
    orientation: opts.orientation ?? 'vertical',
  }
}

function nextEnabled(
  items: string[],
  disabled: string[],
  from: string,
  delta: 1 | -1,
): string | null {
  if (items.length === 0) return null
  const idx = items.indexOf(from)
  if (idx === -1) return null
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const next = items[(idx + delta * i + n * n) % n]!
    if (!disabled.includes(next)) return next
  }
  return null
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

export function update(state: RadioGroupState, msg: RadioGroupMsg): [RadioGroupState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'setValue':
      if (state.disabledItems.includes(msg.value)) return [state, []]
      return [{ ...state, value: msg.value }, []]
    case 'setItems': {
      const disabled = msg.disabled ?? state.disabledItems
      const value =
        state.value && msg.items.includes(state.value) && !disabled.includes(state.value)
          ? state.value
          : null
      return [{ ...state, items: msg.items, disabledItems: disabled, value }, []]
    }
    case 'selectNext': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, 1)
      return to === null ? [state, []] : [{ ...state, value: to }, []]
    }
    case 'selectPrev': {
      const to = nextEnabled(state.items, state.disabledItems, msg.from, -1)
      return to === null ? [state, []] : [{ ...state, value: to }, []]
    }
    case 'selectFirst': {
      const to = firstEnabled(state.items, state.disabledItems)
      return to === null ? [state, []] : [{ ...state, value: to }, []]
    }
    case 'selectLast': {
      const to = lastEnabled(state.items, state.disabledItems)
      return to === null ? [state, []] : [{ ...state, value: to }, []]
    }
  }
}

export interface RadioItemParts<S> {
  root: {
    role: 'radio'
    id: string
    'aria-checked': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    'data-state': (s: S) => 'checked' | 'unchecked'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'radio-group'
    'data-part': 'item'
    'data-value': string
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  label: {
    'data-scope': 'radio-group'
    'data-part': 'label'
    'data-value': string
    for: string
  }
  indicator: {
    'data-state': (s: S) => 'checked' | 'unchecked'
    'data-scope': 'radio-group'
    'data-part': 'indicator'
  }
}

export interface RadioGroupParts<S> {
  root: {
    role: 'radiogroup'
    'aria-orientation': (s: S) => Orientation
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'radio-group'
    'data-part': 'root'
    'data-orientation': (s: S) => Orientation
    'data-disabled': (s: S) => '' | undefined
  }
  item: (value: string) => RadioItemParts<S>
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => RadioGroupState,
  send: Send<RadioGroupMsg>,
  opts: ConnectOptions,
): RadioGroupParts<S> {
  const itemId = (v: string): string => `${opts.id}:item:${v}`

  return {
    root: {
      role: 'radiogroup',
      'aria-orientation': (s) => get(s).orientation,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'radio-group',
      'data-part': 'root',
      'data-orientation': (s) => get(s).orientation,
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    item: (value: string): RadioItemParts<S> => ({
      root: {
        role: 'radio',
        id: itemId(value),
        'aria-checked': (s) => get(s).value === value,
        'aria-disabled': (s) =>
          get(s).disabledItems.includes(value) || get(s).disabled ? 'true' : undefined,
        'data-state': (s) => (get(s).value === value ? 'checked' : 'unchecked'),
        'data-disabled': (s) =>
          get(s).disabledItems.includes(value) || get(s).disabled ? '' : undefined,
        'data-scope': 'radio-group',
        'data-part': 'item',
        'data-value': value,
        // Only currently-selected (or first if none selected) is tab-stop
        tabIndex: (s) => {
          const st = get(s)
          if (st.disabled || st.disabledItems.includes(value)) return -1
          if (st.value === value) return 0
          if (st.value === null) {
            const first = firstEnabled(st.items, st.disabledItems)
            return first === value ? 0 : -1
          }
          return -1
        },
        onClick: () => send({ type: 'setValue', value }),
        onKeyDown: (e) => {
          const key = flipArrow(e.key, e.currentTarget as Element)
          const isVertical =
            (e.currentTarget as HTMLElement | null)?.closest('[data-orientation="vertical"]') !==
            null
          switch (key) {
            case 'ArrowDown':
              if (isVertical) {
                e.preventDefault()
                send({ type: 'selectNext', from: value })
              }
              return
            case 'ArrowUp':
              if (isVertical) {
                e.preventDefault()
                send({ type: 'selectPrev', from: value })
              }
              return
            case 'ArrowRight':
              e.preventDefault()
              send({ type: 'selectNext', from: value })
              return
            case 'ArrowLeft':
              e.preventDefault()
              send({ type: 'selectPrev', from: value })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'selectFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'selectLast' })
              return
            case ' ':
              e.preventDefault()
              send({ type: 'setValue', value })
              return
          }
        },
      },
      label: {
        'data-scope': 'radio-group',
        'data-part': 'label',
        'data-value': value,
        for: itemId(value),
      },
      indicator: {
        'data-state': (s) => (get(s).value === value ? 'checked' : 'unchecked'),
        'data-scope': 'radio-group',
        'data-part': 'indicator',
      },
    }),
  }
}

export const radioGroup = { init, update, connect }
