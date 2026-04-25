import type { Send } from '@llui/dom'

/**
 * Editable — inline text editor. Click preview to enter edit mode, Enter
 * to commit, Escape to cancel. Reports the committed value via `onSubmit`.
 */

export interface EditableState {
  value: string
  editing: boolean
  draft: string
  disabled: boolean
}

export type EditableMsg =
  /** @intent("Enter edit mode (seeds the draft from the current value)") */
  | { type: 'edit' }
  /** @intent("Update the in-progress draft as the user types") */
  | { type: 'setDraft'; draft: string }
  /** @intent("Commit the draft as the new value and exit edit mode") */
  | { type: 'submit' }
  /** @intent("Discard the draft and exit edit mode without changing the value") */
  | { type: 'cancel' }
  /** @intent("Set the value directly without going through edit mode") */
  | { type: 'setValue'; value: string }

export interface EditableInit {
  value?: string
  editing?: boolean
  disabled?: boolean
}

export function init(opts: EditableInit = {}): EditableState {
  const value = opts.value ?? ''
  return {
    value,
    editing: opts.editing ?? false,
    draft: value,
    disabled: opts.disabled ?? false,
  }
}

export function update(state: EditableState, msg: EditableMsg): [EditableState, never[]] {
  if (state.disabled && msg.type !== 'setValue') return [state, []]
  switch (msg.type) {
    case 'edit':
      return [{ ...state, editing: true, draft: state.value }, []]
    case 'setDraft':
      return [{ ...state, draft: msg.draft }, []]
    case 'submit':
      return [{ ...state, editing: false, value: state.draft }, []]
    case 'cancel':
      return [{ ...state, editing: false, draft: state.value }, []]
    case 'setValue':
      return [{ ...state, value: msg.value, draft: msg.value }, []]
  }
}

export interface EditableParts<S> {
  root: {
    'data-scope': 'editable'
    'data-part': 'root'
    'data-editing': (s: S) => '' | undefined
    'data-disabled': (s: S) => '' | undefined
  }
  preview: {
    tabIndex: (s: S) => number
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'editable'
    'data-part': 'preview'
    hidden: (s: S) => boolean
    onClick: (e: MouseEvent) => void
    onFocus: (e: FocusEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  input: {
    'data-scope': 'editable'
    'data-part': 'input'
    hidden: (s: S) => boolean
    value: (s: S) => string
    disabled: (s: S) => boolean
    onInput: (e: Event) => void
    onKeyDown: (e: KeyboardEvent) => void
    onBlur: (e: FocusEvent) => void
  }
  submitTrigger: {
    type: 'button'
    'data-scope': 'editable'
    'data-part': 'submit-trigger'
    onClick: (e: MouseEvent) => void
  }
  cancelTrigger: {
    type: 'button'
    'data-scope': 'editable'
    'data-part': 'cancel-trigger'
    onClick: (e: MouseEvent) => void
  }
  editTrigger: {
    type: 'button'
    'data-scope': 'editable'
    'data-part': 'edit-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  /** Activate edit mode on preview focus (default: false — requires click). */
  activateOnFocus?: boolean
  /** Submit on blur (default: true). False = blur cancels. */
  submitOnBlur?: boolean
  /** Validate the draft text before committing. Non-empty array blocks submit. */
  validate?: (value: string) => string[] | null
}

export function connect<S>(
  get: (s: S) => EditableState,
  send: Send<EditableMsg>,
  opts: ConnectOptions = {},
): EditableParts<S> {
  const activateOnFocus = opts.activateOnFocus === true
  const submitOnBlur = opts.submitOnBlur !== false
  const validate = opts.validate
  let currentDraft = ''

  const trySubmit = () => {
    if (validate) {
      const errors = validate(currentDraft)
      if (errors && errors.length > 0) return
    }
    send({ type: 'submit' })
  }

  return {
    root: {
      'data-scope': 'editable',
      'data-part': 'root',
      'data-editing': (s) => (get(s).editing ? '' : undefined),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    preview: {
      tabIndex: (s) => (get(s).disabled ? -1 : 0),
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'editable',
      'data-part': 'preview',
      hidden: (s) => get(s).editing,
      onClick: () => send({ type: 'edit' }),
      onFocus: () => {
        if (activateOnFocus) send({ type: 'edit' })
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'F2') {
          e.preventDefault()
          send({ type: 'edit' })
        }
      },
    },
    input: {
      'data-scope': 'editable',
      'data-part': 'input',
      hidden: (s) => !get(s).editing,
      value: (s) => get(s).draft,
      disabled: (s) => get(s).disabled,
      onInput: (e) => {
        const draft = (e.target as HTMLInputElement).value
        currentDraft = draft
        send({ type: 'setDraft', draft })
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          trySubmit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          send({ type: 'cancel' })
        }
      },
      onBlur: () => {
        if (submitOnBlur) trySubmit()
        else send({ type: 'cancel' })
      },
    },
    submitTrigger: {
      type: 'button',
      'data-scope': 'editable',
      'data-part': 'submit-trigger',
      onClick: () => trySubmit(),
    },
    cancelTrigger: {
      type: 'button',
      'data-scope': 'editable',
      'data-part': 'cancel-trigger',
      onClick: () => send({ type: 'cancel' }),
    },
    editTrigger: {
      type: 'button',
      'data-scope': 'editable',
      'data-part': 'edit-trigger',
      onClick: () => send({ type: 'edit' }),
    },
  }
}

export const editable = { init, update, connect }
