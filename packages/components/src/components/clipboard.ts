import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'
import { clipboardLocale } from '../locale/clipboard.js'

/**
 * Clipboard — copy-to-clipboard with transient "copied" feedback. The
 * actual clipboard write is performed by the consumer via an effect (or
 * inline in the trigger's onClick handler). Reducer tracks the success
 * state flag.
 *
 * `copy` is a REQUEST and does not set `copied`: the write can fail
 * (permission denied, insecure context, browser policy) and `indicator`
 * carries `aria-live="polite"`, so a flag set before the promise resolves
 * ANNOUNCES a success that never happened (#232). Dispatch `copied` from
 * the resolved write, and `reset` to clear the feedback:
 *
 * ```ts
 * onEffect(effect, send) {
 *   copyToClipboard(effect.value).then(
 *     () => send({ type: 'copied' }),
 *     () => {}, // write failed — say nothing
 *   )
 * }
 * ```
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
      // A REQUEST, not a result. The write is the consumer's effect and it can
      // reject; only the resolved write may claim success (#232).
      return [state, []]
    case 'copied':
      return [{ ...state, copied: true }, []]
    case 'reset':
      return [{ ...state, copied: false }, []]
  }
}

/**
 * Attempt to copy the value to the clipboard. Returns a Promise that RESOLVES
 * on success and REJECTS when the write is refused. Dispatch `copied` from the
 * resolved branch only — the rejected branch must dispatch nothing, since
 * `copied` is false until a write succeeds and `reset` after a failure would
 * announce and then retract a success that never happened.
 */
export async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  // Fallback: ephemeral textarea. This path is what runs in an INSECURE CONTEXT,
  // where `navigator.clipboard` is undefined — one of the three refusal cases the
  // contract above names — so discarding `execCommand`'s boolean here resolves on a
  // refused write and re-opens #232 one branch down: the consumer dispatches
  // `copied` and the live region announces a copy that did not happen.
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    if (!document.execCommand('copy')) {
      throw new Error('clipboard write refused')
    }
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
    readonly: true
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
  /**
   * Called from the trigger with the value to write, alongside the `copy`
   * message. This is the seam for performing the write when the consumer does
   * not route it through an effect; dispatch `copied` from its resolved
   * promise, never from the call itself.
   */
  onCopy?: (value: string) => void
}

export function connect(
  state: Signal<ClipboardState>,
  send: Send<ClipboardMsg>,
  opts: ConnectOptions = {},
): ClipboardParts {
  const locale = clipboardLocale()
  const copyLabel = opts.copyLabel ?? locale.copy
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
        opts.onCopy?.(state.peek().value)
      }),
    },
    input: {
      type: 'text',
      readonly: true,
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
