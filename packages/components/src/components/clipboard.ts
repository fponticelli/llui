import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

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
  | { type: 'setValue'; value: string }
  | { type: 'copy' }
  | { type: 'copied' }
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

export interface ClipboardParts<S> {
  root: {
    'data-scope': 'clipboard'
    'data-part': 'root'
    'data-copied': (s: S) => '' | undefined
  }
  trigger: {
    type: 'button'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'clipboard'
    'data-part': 'trigger'
    'data-copied': (s: S) => '' | undefined
    onClick: (e: MouseEvent) => void
  }
  input: {
    type: 'text'
    readOnly: true
    value: (s: S) => string
    'data-scope': 'clipboard'
    'data-part': 'input'
    onFocus: (e: FocusEvent) => void
  }
  indicator: {
    'data-scope': 'clipboard'
    'data-part': 'indicator'
    'data-copied': (s: S) => '' | undefined
    'aria-live': 'polite'
  }
}

export interface ConnectOptions {
  copyLabel?: string
  onCopy?: (value: string) => void
}

export function connect<S>(
  get: (s: S) => ClipboardState,
  send: Send<ClipboardMsg>,
  opts: ConnectOptions = {},
): ClipboardParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const copyLabel: string | ((s: S) => string) =
    opts.copyLabel ?? ((s: S) => locale(s).clipboard.copy)
  return {
    root: {
      'data-scope': 'clipboard',
      'data-part': 'root',
      'data-copied': (s) => (get(s).copied ? '' : undefined),
    },
    trigger: {
      type: 'button',
      'aria-label': copyLabel,
      'data-scope': 'clipboard',
      'data-part': 'trigger',
      'data-copied': (s) => (get(s).copied ? '' : undefined),
      onClick: () => {
        send({ type: 'copy' })
        opts.onCopy?.('')
      },
    },
    input: {
      type: 'text',
      readOnly: true,
      value: (s) => get(s).value,
      'data-scope': 'clipboard',
      'data-part': 'input',
      onFocus: (e) => (e.currentTarget as HTMLInputElement).select(),
    },
    indicator: {
      'data-scope': 'clipboard',
      'data-part': 'indicator',
      'data-copied': (s) => (get(s).copied ? '' : undefined),
      'aria-live': 'polite',
    },
  }
}

export const clipboard = { init, update, connect, copyToClipboard }
