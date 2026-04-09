import type { Send } from '@llui/dom'
import { flipArrow } from '../utils/direction'

/**
 * Rating group — a sequence of clickable items (stars) representing a
 * discrete rating. Supports half-step ratings and keyboard navigation.
 */

export interface RatingGroupState {
  value: number
  count: number
  /** If true, allows values like 1.5 (half-stars). */
  allowHalf: boolean
  disabled: boolean
  readOnly: boolean
  hoveredValue: number | null
}

export type RatingGroupMsg =
  | { type: 'setValue'; value: number }
  | { type: 'hover'; value: number | null }
  | { type: 'clickItem'; index: number; isLeftHalf: boolean }
  | { type: 'hoverItem'; index: number; isLeftHalf: boolean }
  | { type: 'incrementValue'; step?: number }
  | { type: 'decrementValue'; step?: number }
  | { type: 'toEnd' }

export interface RatingGroupInit {
  value?: number
  count?: number
  allowHalf?: boolean
  disabled?: boolean
  readOnly?: boolean
}

export function init(opts: RatingGroupInit = {}): RatingGroupState {
  return {
    value: opts.value ?? 0,
    count: opts.count ?? 5,
    allowHalf: opts.allowHalf ?? false,
    disabled: opts.disabled ?? false,
    readOnly: opts.readOnly ?? false,
    hoveredValue: null,
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function update(state: RatingGroupState, msg: RatingGroupMsg): [RatingGroupState, never[]] {
  if (state.disabled || state.readOnly) {
    if (msg.type === 'hover') return [{ ...state, hoveredValue: null }, []]
    return [state, []]
  }
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: clamp(msg.value, 0, state.count) }, []]
    case 'hover':
      return [{ ...state, hoveredValue: msg.value }, []]
    case 'clickItem': {
      const base = msg.index + 1
      const v = state.allowHalf && msg.isLeftHalf ? base - 0.5 : base
      return [{ ...state, value: clamp(v, 0, state.count) }, []]
    }
    case 'hoverItem': {
      const base = msg.index + 1
      const v = state.allowHalf && msg.isLeftHalf ? base - 0.5 : base
      return [{ ...state, hoveredValue: v }, []]
    }
    case 'incrementValue': {
      const step = msg.step ?? (state.allowHalf ? 0.5 : 1)
      return [{ ...state, value: clamp(state.value + step, 0, state.count) }, []]
    }
    case 'decrementValue': {
      const step = msg.step ?? (state.allowHalf ? 0.5 : 1)
      return [{ ...state, value: clamp(state.value - step, 0, state.count) }, []]
    }
    case 'toEnd':
      return [{ ...state, value: state.count }, []]
  }
}

export type ItemFill = 'full' | 'half' | 'empty'

export function itemFill(state: RatingGroupState, index: number): ItemFill {
  const reference = state.hoveredValue ?? state.value
  const itemValue = index + 1
  if (reference >= itemValue) return 'full'
  if (state.allowHalf && reference >= itemValue - 0.5) return 'half'
  return 'empty'
}

export interface RatingItemParts<S> {
  root: {
    role: 'radio'
    'aria-checked': (s: S) => boolean
    'data-fill': (s: S) => ItemFill
    'data-scope': 'rating-group'
    'data-part': 'item'
    'data-value': string
    'data-disabled': (s: S) => '' | undefined
    tabIndex: (s: S) => number
    onClick: (e: MouseEvent) => void
    onPointerMove: (e: PointerEvent) => void
    onPointerLeave: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export interface RatingGroupParts<S> {
  root: {
    role: 'radiogroup'
    'aria-label': string | undefined
    'aria-disabled': (s: S) => 'true' | undefined
    'aria-readonly': (s: S) => 'true' | undefined
    'data-scope': 'rating-group'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
    'data-readonly': (s: S) => '' | undefined
  }
  item: (index: number) => RatingItemParts<S>
}

export interface ConnectOptions {
  label?: string
}

export function connect<S>(
  get: (s: S) => RatingGroupState,
  send: Send<RatingGroupMsg>,
  opts: ConnectOptions = {},
): RatingGroupParts<S> {
  return {
    root: {
      role: 'radiogroup',
      'aria-label': opts.label,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'aria-readonly': (s) => (get(s).readOnly ? 'true' : undefined),
      'data-scope': 'rating-group',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-readonly': (s) => (get(s).readOnly ? '' : undefined),
    },
    item: (index: number): RatingItemParts<S> => ({
      root: {
        role: 'radio',
        'aria-checked': (s) => Math.ceil(get(s).value) === index + 1,
        'data-fill': (s) => itemFill(get(s), index),
        'data-scope': 'rating-group',
        'data-part': 'item',
        'data-value': String(index + 1),
        'data-disabled': (s) => (get(s).disabled ? '' : undefined),
        tabIndex: (s) => {
          const st = get(s)
          if (st.disabled || st.readOnly) return -1
          // Only current active item is tab stop
          const active = Math.ceil(st.value) || 1
          return active === index + 1 ? 0 : -1
        },
        onClick: (e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const isLeftHalf = e.clientX - rect.left < rect.width / 2
          send({ type: 'clickItem', index, isLeftHalf })
        },
        onPointerMove: (e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const isLeftHalf = e.clientX - rect.left < rect.width / 2
          send({ type: 'hoverItem', index, isLeftHalf })
        },
        onPointerLeave: () => send({ type: 'hover', value: null }),
        onKeyDown: (e) => {
          const key = flipArrow(e.key, e.currentTarget as Element)
          switch (key) {
            case 'ArrowRight':
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'incrementValue' })
              return
            case 'ArrowLeft':
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'decrementValue' })
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'setValue', value: 0 })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'toEnd' })
              return
          }
        },
      },
    }),
  }
}

export const ratingGroup = { init, update, connect, itemFill }
