import type { Send } from '@llui/dom'

/**
 * Tags input — text input that creates chips (tags) on commit keys
 * (Enter, comma, blur). Backspace on empty input removes the last tag.
 * Each tag is focusable via arrow keys.
 */

export interface TagsInputState {
  value: string[]
  inputValue: string
  disabled: boolean
  /** Maximum tag count. 0 = unlimited. */
  max: number
  /** Only allow unique values. */
  unique: boolean
  /** Currently-focused tag index, or null. */
  focusedIndex: number | null
}

export type TagsInputMsg =
  | { type: 'setInput'; value: string }
  | { type: 'addTag'; value?: string }
  | { type: 'removeTag'; index: number }
  | { type: 'removeLast' }
  | { type: 'setValue'; value: string[] }
  | { type: 'focusTag'; index: number | null }
  | { type: 'focusTagNext' }
  | { type: 'focusTagPrev' }
  | { type: 'clearAll' }

export interface TagsInputInit {
  value?: string[]
  inputValue?: string
  disabled?: boolean
  max?: number
  unique?: boolean
}

export function init(opts: TagsInputInit = {}): TagsInputState {
  return {
    value: opts.value ?? [],
    inputValue: opts.inputValue ?? '',
    disabled: opts.disabled ?? false,
    max: opts.max ?? 0,
    unique: opts.unique ?? true,
    focusedIndex: null,
  }
}

export function update(state: TagsInputState, msg: TagsInputMsg): [TagsInputState, never[]] {
  if (state.disabled && msg.type !== 'setValue') return [state, []]
  switch (msg.type) {
    case 'setInput':
      return [{ ...state, inputValue: msg.value }, []]
    case 'addTag': {
      const candidate = (msg.value ?? state.inputValue).trim()
      if (candidate === '') return [{ ...state, inputValue: '' }, []]
      if (state.unique && state.value.includes(candidate)) return [{ ...state, inputValue: '' }, []]
      if (state.max > 0 && state.value.length >= state.max)
        return [{ ...state, inputValue: '' }, []]
      return [{ ...state, value: [...state.value, candidate], inputValue: '' }, []]
    }
    case 'removeTag': {
      const value = state.value.filter((_, i) => i !== msg.index)
      return [{ ...state, value, focusedIndex: null }, []]
    }
    case 'removeLast':
      if (state.value.length === 0) return [state, []]
      return [{ ...state, value: state.value.slice(0, -1) }, []]
    case 'setValue':
      return [{ ...state, value: msg.value }, []]
    case 'focusTag':
      return [{ ...state, focusedIndex: msg.index }, []]
    case 'focusTagNext': {
      const len = state.value.length
      if (len === 0) return [state, []]
      if (state.focusedIndex === null) return [state, []]
      const next = state.focusedIndex + 1
      return [{ ...state, focusedIndex: next >= len ? null : next }, []]
    }
    case 'focusTagPrev': {
      const len = state.value.length
      if (len === 0) return [state, []]
      if (state.focusedIndex === null) return [{ ...state, focusedIndex: len - 1 }, []]
      return [{ ...state, focusedIndex: Math.max(0, state.focusedIndex - 1) }, []]
    }
    case 'clearAll':
      return [{ ...state, value: [], focusedIndex: null }, []]
  }
}

export interface TagItemParts<S> {
  root: {
    role: 'button'
    tabIndex: (s: S) => number
    'data-scope': 'tags-input'
    'data-part': 'tag'
    'data-value': string
    'data-index': string
    'data-focused': (s: S) => '' | undefined
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  remove: {
    type: 'button'
    'aria-label': string
    tabIndex: -1
    'data-scope': 'tags-input'
    'data-part': 'tag-remove'
    onClick: (e: MouseEvent) => void
  }
}

export interface TagsInputParts<S> {
  root: {
    role: 'group'
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'tags-input'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  input: {
    type: 'text'
    autoComplete: 'off'
    'aria-label': string
    disabled: (s: S) => boolean
    value: (s: S) => string
    'data-scope': 'tags-input'
    'data-part': 'input'
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  tag: (value: string, index: number) => TagItemParts<S>
  clearTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'tags-input'
    'data-part': 'clear-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  inputLabel?: string
  removeLabel?: string
  clearLabel?: string
  /** Characters that commit the current input as a tag (default: [',']). */
  delimiters?: string[]
  /** Commit on blur (default: true). */
  commitOnBlur?: boolean
  /** Validate a tag value before adding. Non-empty array blocks addTag. */
  validate?: (value: string) => string[] | null
}

export function connect<S>(
  get: (s: S) => TagsInputState,
  send: Send<TagsInputMsg>,
  opts: ConnectOptions = {},
): TagsInputParts<S> {
  const inputLabel = opts.inputLabel ?? 'Add tag'
  const removeLabel = opts.removeLabel ?? 'Remove tag'
  const clearLabel = opts.clearLabel ?? 'Clear all tags'
  const delimiters = opts.delimiters ?? [',']
  const commitOnBlur = opts.commitOnBlur !== false
  const validate = opts.validate
  let currentInput = ''

  const tryAddTag = () => {
    const candidate = currentInput.trim()
    if (validate && candidate !== '') {
      const errors = validate(candidate)
      if (errors && errors.length > 0) return
    }
    send({ type: 'addTag' })
  }

  return {
    root: {
      role: 'group',
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'tags-input',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    input: {
      type: 'text',
      autoComplete: 'off',
      'aria-label': inputLabel,
      disabled: (s) => get(s).disabled,
      value: (s) => get(s).inputValue,
      'data-scope': 'tags-input',
      'data-part': 'input',
      onInput: (e) => {
        currentInput = (e.target as HTMLInputElement).value
        send({ type: 'setInput', value: currentInput })
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          tryAddTag()
        } else if (delimiters.includes(e.key)) {
          e.preventDefault()
          tryAddTag()
        } else if (e.key === 'Backspace') {
          const target = e.target as HTMLInputElement
          if (target.value === '') {
            send({ type: 'removeLast' })
          }
        } else if (e.key === 'ArrowLeft') {
          const target = e.target as HTMLInputElement
          if (target.value === '') {
            e.preventDefault()
            send({ type: 'focusTagPrev' })
          }
        }
      },
      onBlur: () => {
        if (commitOnBlur) tryAddTag()
      },
    },
    tag: (value: string, index: number): TagItemParts<S> => ({
      root: {
        role: 'button',
        tabIndex: (s) => (get(s).focusedIndex === index ? 0 : -1),
        'data-scope': 'tags-input',
        'data-part': 'tag',
        'data-value': value,
        'data-index': String(index),
        'data-focused': (s) => (get(s).focusedIndex === index ? '' : undefined),
        onFocus: () => send({ type: 'focusTag', index }),
        onKeyDown: (e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            send({ type: 'focusTagPrev' })
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            send({ type: 'focusTagNext' })
          } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault()
            send({ type: 'removeTag', index })
          }
        },
      },
      remove: {
        type: 'button',
        'aria-label': removeLabel,
        tabIndex: -1,
        'data-scope': 'tags-input',
        'data-part': 'tag-remove',
        onClick: () => send({ type: 'removeTag', index }),
      },
    }),
    clearTrigger: {
      type: 'button',
      'aria-label': clearLabel,
      'data-scope': 'tags-input',
      'data-part': 'clear-trigger',
      onClick: () => send({ type: 'clearAll' }),
    },
  }
}

export const tagsInput = { init, update, connect }
