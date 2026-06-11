import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'

/**
 * Search field — a `role="search"` landmark wrapping a `type="search"` input
 * with a clear button. Escape clears the field (when non-empty), Enter submits
 * the current value.
 *
 * Debounced live search is intentionally NOT built into this machine. Keep it
 * consumer-side: debounce the `setValue` message (or a derived "search" effect)
 * with `debounce` from `@llui/effects` so the search trigger fires once the user
 * pauses typing, rather than on every keystroke.
 */

export interface SearchFieldState {
  value: string
  disabled: boolean
}

export type SearchFieldMsg =
  /** @humanOnly */
  | { type: 'setValue'; value: string }
  /** @intent("Clear the search field") */
  | { type: 'clear' }
  /** @intent("Submit the current search query") */
  | { type: 'submit'; value: string }

export interface SearchFieldInit {
  value?: string
  disabled?: boolean
}

export function init(opts: SearchFieldInit = {}): SearchFieldState {
  return {
    value: opts.value ?? '',
    disabled: opts.disabled ?? false,
  }
}

export function update(state: SearchFieldState, msg: SearchFieldMsg): [SearchFieldState, never[]] {
  if (state.disabled && msg.type !== 'submit') return [state, []]
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'clear':
      return [{ ...state, value: '' }, []]
    case 'submit':
      return [state, []]
  }
}

export interface SearchFieldParts {
  root: {
    role: 'search'
    'data-scope': 'search-field'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  label: {
    'data-scope': 'search-field'
    'data-part': 'label'
  }
  input: {
    type: 'search'
    disabled: Signal<boolean>
    value: Signal<string>
    'data-scope': 'search-field'
    'data-part': 'input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  clearTrigger: {
    type: 'button'
    'aria-label': string
    hidden: Signal<boolean>
    tabindex: -1
    'data-scope': 'search-field'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  /** Accessible label for the clear button. */
  clearLabel?: string
}

export function connect(
  state: Signal<SearchFieldState>,
  send: Send<SearchFieldMsg>,
  opts: ConnectOptions = {},
): SearchFieldParts {
  const clearLabel = opts.clearLabel ?? 'Clear search'

  return {
    root: {
      role: 'search',
      'data-scope': 'search-field',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    label: {
      'data-scope': 'search-field',
      'data-part': 'label',
    },
    input: {
      type: 'search',
      disabled: state.map((s) => s.disabled),
      value: state.map((s) => s.value),
      'data-scope': 'search-field',
      'data-part': 'input',
      onInput: tagSend(send, ['setValue'], (e) =>
        send({ type: 'setValue', value: (e.target as HTMLInputElement).value }),
      ),
      onKeyDown: tagSend(send, ['clear', 'submit'], (e) => {
        const value = (e.currentTarget as HTMLInputElement).value
        if (e.key === 'Escape') {
          // Only consume the event when there is something to clear; otherwise
          // let it propagate (e.g. to close a surrounding dialog/combobox).
          if (value !== '') {
            e.preventDefault()
            e.stopPropagation()
            send({ type: 'clear' })
          }
        } else if (e.key === 'Enter') {
          e.preventDefault()
          send({ type: 'submit', value })
        }
      }),
    },
    clearTrigger: {
      type: 'button',
      'aria-label': clearLabel,
      hidden: state.map((s) => s.value === ''),
      tabindex: -1,
      'data-scope': 'search-field',
      'data-part': 'clear-trigger',
      onClick: tagSend(send, ['clear'], () => send({ type: 'clear' })),
    },
  }
}

export const searchField = { init, update, connect }
