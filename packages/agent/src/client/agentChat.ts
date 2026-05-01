import type { AgentEffect } from './effects.js'

/**
 * In-app chat composer slice. Owns the editor-state half of the
 * conversational surface (`pendingInput`, `submitting`); the
 * timeline half lives in `agentLog` (which renders the user's
 * submission as a `LogEntry { kind: 'user-input' }` alongside agent
 * actions, so the conversation reads chronologically).
 *
 * Pattern: host wires the slice into its app state via
 * `sliceHandler`, spreads `connect()`'s prop bag into the host's
 * own input/button layout, and the `Submit` Msg fires an effect
 * that the framework's effect handler turns into a WS
 * `user-input-submitted` frame + a synthesized log entry. The
 * agent's `wait_for_user_input` LAP tool picks up the frame at the
 * server.
 *
 * The composer is NOT an LLM. It's a relay surface: the user's text
 * is delivered to the user's own LLM (Claude desktop / IDE / wherever
 * is mounted on the MCP bridge), which already has cross-app context.
 * The framework just provides the in-app rendezvous so the user
 * doesn't have to alt-tab to a different window to talk to their
 * agent about the app they're looking at.
 */
export type AgentChatState = {
  /** Current contents of the input field. Bound to the input's `value`. */
  pendingInput: string
  /**
   * True between `Submit` and the effect handler completing the
   * frame send. Disables the submit button and (typically) the
   * input itself; reducer-driven so the UI never disagrees.
   */
  submitting: boolean
}

export type AgentChatInitOpts = {
  /** Pre-fill the input on mount — e.g. session-restore. */
  initialInput?: string
}

export type AgentChatMsg =
  | {
      /** Bound to the input's `oninput` event. Round-trip stays in the slice. */
      type: 'SetInput'
      value: string
    }
  | {
      /**
       * Bound to the submit button's `onClick` and the input's
       * `onKeyDown` (Enter, no shift). Reducer:
       *
       *   - Empty/whitespace → no-op (no effect, no state change).
       *   - Has content → clear `pendingInput`, set `submitting: true`,
       *     emit `AgentChatSendInput { text, at }` effect.
       */
      type: 'Submit'
    }
  | {
      /**
       * Fired by the effect handler after the frame sends so the
       * UI re-enables the input. Always paired 1:1 with each
       * dispatched `AgentChatSendInput` effect.
       */
      type: 'SubmitComplete'
    }

export function init(opts: AgentChatInitOpts = {}): [AgentChatState, AgentEffect[]] {
  return [
    {
      pendingInput: opts.initialInput ?? '',
      submitting: false,
    },
    [],
  ]
}

export function update(state: AgentChatState, msg: AgentChatMsg): [AgentChatState, AgentEffect[]] {
  switch (msg.type) {
    case 'SetInput':
      // No-op when the value is identical — keeps state ref stable
      // for memoization above this slice.
      if (msg.value === state.pendingInput) return [state, []]
      return [{ ...state, pendingInput: msg.value }, []]
    case 'Submit': {
      // Don't double-submit while a previous send is in flight, and
      // don't send empty/whitespace messages — neither is a useful
      // signal for the agent and both are common bounce events
      // (keyboard auto-repeat on Enter, click-then-click-again).
      if (state.submitting) return [state, []]
      const trimmed = state.pendingInput.trim()
      if (trimmed.length === 0) return [state, []]
      const at = Date.now()
      return [
        { ...state, pendingInput: '', submitting: true },
        [{ type: 'AgentChatSendInput', text: trimmed, at }],
      ]
    }
    case 'SubmitComplete':
      if (!state.submitting) return [state, []]
      return [{ ...state, submitting: false }, []]
  }
}

import { tagSend, type Send } from '@llui/dom'

/**
 * Static-prop-bag-with-reactive-accessors. Spread directly into
 * element helpers; matches the convention of the other agent
 * namespaces.
 *
 * The `input` bag carries both `oninput` and `onkeydown` because
 * the canonical chat-composer affordance is "type, press Enter"
 * (Shift+Enter for newline if the host wraps it themselves). Hosts
 * that want a multiline textarea can spread `input.oninput` and
 * skip `onkeydown`, wiring submit to the button only.
 */
export type ConnectBag<S> = {
  root: { 'data-scope': 'agent-chat'; 'data-submitting': (s: S) => boolean }
  input: {
    'data-part': 'input'
    value: (s: S) => string
    disabled: (s: S) => boolean
    oninput: (e: Event) => void
    onkeydown: (e: KeyboardEvent) => void
  }
  submitButton: {
    'data-part': 'submit'
    onClick: () => void
    disabled: (s: S) => boolean
  }
  /**
   * True iff the input has non-whitespace content AND we're not
   * mid-submit. Useful as the predicate for a "send" affordance
   * separate from the button's own `disabled` field (e.g. a
   * keyboard-shortcut hint).
   */
  canSubmit: (s: S) => boolean
}

export function connect<S>(get: (s: S) => AgentChatState, send: Send<AgentChatMsg>): ConnectBag<S> {
  const submit = tagSend(send, ['Submit'], () => send({ type: 'Submit' }))
  const setInput = (value: string) => send({ type: 'SetInput', value })
  return {
    root: {
      'data-scope': 'agent-chat',
      'data-submitting': (s) => get(s).submitting,
    },
    input: {
      'data-part': 'input',
      value: (s) => get(s).pendingInput,
      disabled: (s) => get(s).submitting,
      oninput: (e) => {
        // The cast is the standard "input event target is an
        // HTMLInputElement / HTMLTextAreaElement" assumption; we
        // coerce via `.value`. Hosts using non-DOM inputs (custom
        // contenteditable etc.) bypass this prop bag and dispatch
        // SetInput directly.
        const target = e.target as { value?: string } | null
        if (target && typeof target.value === 'string') setInput(target.value)
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          submit()
        }
      },
    },
    submitButton: {
      'data-part': 'submit',
      onClick: submit,
      disabled: (s) => {
        const cs = get(s)
        return cs.submitting || cs.pendingInput.trim().length === 0
      },
    },
    canSubmit: (s) => {
      const cs = get(s)
      return !cs.submitting && cs.pendingInput.trim().length > 0
    },
  }
}
