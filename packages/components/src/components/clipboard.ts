import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'

/**
 * Clipboard — copy-to-clipboard with transient "copied" feedback. The
 * actual clipboard write is performed by the consumer via an effect (or
 * inline in the trigger's onClick handler). Reducer tracks the success
 * state flag and an auto-reset timestamp.
 */

export interface ClipboardState {
  value: string
  copied: boolean
}

export type ClipboardMsg =
  /** @intent("Update the value to be copied") */
  | { type: 'setValue'; value: string }
  /** @intent("Initiate a clipboard copy of the current value") */
  | { type: 'copy' }
  /** @humanOnly */
  | { type: 'copied' }
  /** @intent("Clear the transient \"copied\" feedback state") */
  | { type: 'reset' }

export interface ClipboardInit {
  value?: string
}

export function init(opts: ClipboardInit = {}): ClipboardState {
  return { value: opts.value ?? '', copied: false }
}

export function update(state: ClipboardState, msg: ClipboardMsg): [ClipboardState, never[]] {
  switch (msg.type) {
    case 'setValue':
      return [{ ...state, value: msg.value, copied: false }, []]
    case 'copy':
    case 'copied':
      return [{ ...state, copied: true }, []]
    case 'reset':
      return [{ ...state, copied: false }, []]
  }
}

/**
 * Attempt to copy the value to the clipboard. Returns a Promise that resolves
 * on success. Consumer dispatches `copied` or `reset` based on the result.
 */
export async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  // Fallback: ephemeral textarea
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

export interface ClipboardParts {
  root: {
    'data-scope': 'clipboard'
    'data-part': 'root'
    'data-copied': Signal<'' | undefined>
  }
  trigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'clipboard'
    'data-part': 'trigger'
    'data-copied': Signal<'' | undefined>
    onClick: (e: MouseEvent) => void
  }
  input: {
    type: 'text'
    readOnly: true
    value: Signal<string>
    'data-scope': 'clipboard'
    'data-part': 'input'
    onFocus: (e: FocusEvent) => void
  }
  indicator: {
    'data-scope': 'clipboard'
    'data-part': 'indicator'
    'data-copied': Signal<'' | undefined>
    'aria-live': 'polite'
  }
}

export interface ConnectOptions {
  copyLabel?: string
  onCopy?: (value: string) => void
}

export function connect(
  state: Signal<ClipboardState>,
  send: Send<ClipboardMsg>,
  opts: ConnectOptions = {},
): ClipboardParts {
  const locale = useContext(LocaleContext)
  const copyLabel = opts.copyLabel ?? locale.clipboard.copy
  return {
    root: {
      'data-scope': 'clipboard',
      'data-part': 'root',
      'data-copied': state.map((s) => (s.copied ? '' : undefined)),
    },
    trigger: {
      type: 'button',
      'aria-label': copyLabel,
      'data-scope': 'clipboard',
      'data-part': 'trigger',
      'data-copied': state.map((s) => (s.copied ? '' : undefined)),
      onClick: tagSend(send, ['copy'], () => {
        send({ type: 'copy' })
        opts.onCopy?.('')
      }),
    },
    input: {
      type: 'text',
      readOnly: true,
      value: state.map((s) => s.value),
      'data-scope': 'clipboard',
      'data-part': 'input',
      onFocus: (e) => (e.currentTarget as HTMLInputElement).select(),
    },
    indicator: {
      'data-scope': 'clipboard',
      'data-part': 'indicator',
      'data-copied': state.map((s) => (s.copied ? '' : undefined)),
      'aria-live': 'polite',
    },
  }
}

export const clipboard = { init, update, connect, copyToClipboard }
