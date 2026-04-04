import type { Send } from '@llui/dom'

/**
 * Toggle button — a button that can be pressed or not. Unlike a checkbox,
 * a toggle represents an action that is applied immediately (e.g. "bold" in
 * a text editor toolbar).
 */

export interface ToggleState {
  pressed: boolean
  disabled: boolean
}

export type ToggleMsg =
  | { type: 'toggle' }
  | { type: 'setPressed'; pressed: boolean }
  | { type: 'setDisabled'; disabled: boolean }

export interface ToggleInit {
  pressed?: boolean
  disabled?: boolean
}

export function init(opts: ToggleInit = {}): ToggleState {
  return {
    pressed: opts.pressed ?? false,
    disabled: opts.disabled ?? false,
  }
}

export function update(state: ToggleState, msg: ToggleMsg): [ToggleState, never[]] {
  switch (msg.type) {
    case 'toggle':
      if (state.disabled) return [state, []]
      return [{ ...state, pressed: !state.pressed }, []]
    case 'setPressed':
      return [{ ...state, pressed: msg.pressed }, []]
    case 'setDisabled':
      return [{ ...state, disabled: msg.disabled }, []]
  }
}

export interface ToggleParts<S> {
  root: {
    type: 'button'
    role: 'button'
    'aria-pressed': (s: S) => boolean
    'aria-disabled': (s: S) => 'true' | undefined
    disabled: (s: S) => boolean
    'data-state': (s: S) => 'on' | 'off'
    'data-disabled': (s: S) => '' | undefined
    'data-scope': 'toggle'
    'data-part': 'root'
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export function connect<S>(get: (s: S) => ToggleState, send: Send<ToggleMsg>): ToggleParts<S> {
  return {
    root: {
      type: 'button',
      role: 'button',
      'aria-pressed': (s) => get(s).pressed,
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      disabled: (s) => get(s).disabled,
      'data-state': (s) => (get(s).pressed ? 'on' : 'off'),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      'data-scope': 'toggle',
      'data-part': 'root',
      onClick: () => send({ type: 'toggle' }),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          send({ type: 'toggle' })
        }
      },
    },
  }
}

export const toggle = { init, update, connect }
