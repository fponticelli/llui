import type { Send } from '@llui/dom'
import type { AgentSession, AgentToken } from '../protocol.js'
import type { AgentEffect } from './effects.js'

export type AgentConnectStatus = 'idle' | 'minting' | 'pending-claude' | 'active' | 'error'

export type AgentConnectPendingToken = {
  token: AgentToken
  tid: string
  lapUrl: string
  connectSnippet: string // "/llui-connect <lapUrl> <token>"
  expiresAt: number
}

export type AgentConnectState = {
  status: AgentConnectStatus
  pendingToken: AgentConnectPendingToken | null
  sessions: AgentSession[]
  resumable: AgentSession[]
  error: { code: string; detail: string } | null
}

export type AgentConnectMsg =
  | { type: 'Mint' }
  | {
      type: 'MintSucceeded'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  | { type: 'MintFailed'; error: { code: string; detail: string } }
  | { type: 'WsOpened' }
  | { type: 'WsClosed' }
  | { type: 'ActivatedByClaude' }
  | { type: 'ResumeList'; tids: string[] }
  | { type: 'ResumeListLoaded'; sessions: AgentSession[] }
  | { type: 'Resume'; tid: string }
  | { type: 'Revoke'; tid: string }
  | { type: 'ClearError' }
  | { type: 'SessionsLoaded'; sessions: AgentSession[] }
  | { type: 'RefreshSessions' }
  /** User clicked the "Copy connect snippet" affordance. Resolves the
   *  pendingToken's snippet in update() (state-reading is what update()
   *  is for) and dispatches a clipboard-write effect. */
  | { type: 'CopyConnectSnippet' }

export type AgentConnectInitOpts = { mintUrl: string }

/** Component shape is [State, Effect[]] — consistent with @llui/components. */
export function init(_opts: AgentConnectInitOpts): [AgentConnectState, AgentEffect[]] {
  return [
    {
      status: 'idle',
      pendingToken: null,
      sessions: [],
      resumable: [],
      error: null,
    },
    [],
  ]
}

export function update(
  state: AgentConnectState,
  msg: AgentConnectMsg,
  opts: AgentConnectInitOpts,
): [AgentConnectState, AgentEffect[]] {
  switch (msg.type) {
    case 'Mint':
      return [
        { ...state, status: 'minting' },
        [{ type: 'AgentMintRequest', mintUrl: opts.mintUrl }],
      ]
    case 'MintSucceeded': {
      const pending: AgentConnectPendingToken = {
        token: msg.token,
        tid: msg.tid,
        lapUrl: msg.lapUrl,
        connectSnippet: `/llui-connect ${msg.lapUrl} ${msg.token}`,
        expiresAt: msg.expiresAt,
      }
      return [
        { ...state, status: 'pending-claude', pendingToken: pending, error: null },
        [{ type: 'AgentOpenWS', token: msg.token, wsUrl: msg.wsUrl }],
      ]
    }
    case 'MintFailed':
      return [{ ...state, status: 'error', error: msg.error }, []]
    case 'WsOpened':
      // WS is open but Claude hasn't bound yet; stay at pending-claude.
      return [state, []]
    case 'WsClosed':
      return [{ ...state, status: 'idle', pendingToken: null }, []]
    case 'ActivatedByClaude':
      return [{ ...state, status: 'active' }, []]
    case 'ResumeList':
      return [state, [{ type: 'AgentResumeCheck', tids: msg.tids }]]
    case 'ResumeListLoaded':
      return [{ ...state, resumable: msg.sessions }, []]
    case 'Resume':
      return [state, [{ type: 'AgentResumeClaim', tid: msg.tid }]]
    case 'Revoke': {
      // Optimistically remove from sessions + resumable.
      return [
        {
          ...state,
          sessions: state.sessions.filter((s) => s.tid !== msg.tid),
          resumable: state.resumable.filter((s) => s.tid !== msg.tid),
        },
        [{ type: 'AgentRevoke', tid: msg.tid }],
      ]
    }
    case 'ClearError':
      return [{ ...state, error: null }, []]
    case 'SessionsLoaded':
      return [{ ...state, sessions: msg.sessions }, []]
    case 'RefreshSessions':
      return [state, [{ type: 'AgentSessionsList' }]]
    case 'CopyConnectSnippet': {
      // No-op when there's no pending token — the button's
      // `disabled` accessor already gates the click, but we accept
      // the message for runtime safety.
      if (!state.pendingToken) return [state, []]
      return [state, [{ type: 'AgentClipboardWrite', text: state.pendingToken.connectSnippet }]]
    }
  }
}

// ── Connect helper ────────────────────────────────────────────────────────────

export type AgentConnectConnectOptions = {
  id?: string // optional DOM id prefix
}

/**
 * Static prop bag with reactive accessors. Mirrors the @llui/components
 * pattern (e.g. `dialog.connect`): callers spread bag keys directly
 * into element helpers, and function-valued props re-evaluate per
 * binding-mask hit. The previous shape — `(state) => bag` — required
 * callers to wrap every prop access in their own arrow, which the
 * documented usage didn't do (and silently produced `undefined` props
 * when spread).
 */
export type ConnectBag<S> = {
  root: { 'data-scope': 'agent-connect'; 'data-state': (s: S) => AgentConnectStatus }
  mintTrigger: { onClick: () => void; disabled: (s: S) => boolean }
  pendingTokenBox: { 'data-part': 'pending-token'; 'data-visible': (s: S) => boolean }
  copyConnectSnippetButton: { onClick: () => void; disabled: (s: S) => boolean }
  sessionsList: { 'data-part': 'sessions-list' }
  sessionItem: (tid: string) => { 'data-part': 'session-item'; 'data-tid': string }
  revokeButton: (tid: string) => { onClick: () => void }
  resumeBanner: { 'data-part': 'resume-banner'; 'data-visible': (s: S) => boolean }
  resumeItem: (tid: string) => { 'data-part': 'resume-item'; 'data-tid': string }
  resumeButton: (tid: string) => { onClick: () => void }
  dismissButton: (tid: string) => { onClick: () => void }
  error: {
    'data-part': 'error'
    'data-visible': (s: S) => boolean
    onClick: () => void
  }
}

/**
 * Builds prop bags for the view. Static-bag-with-reactive-accessors
 * shape (matches the @llui/components convention); spread directly
 * into element helpers.
 */
export function connect<S>(
  get: (s: S) => AgentConnectState,
  send: Send<AgentConnectMsg>,
  _opts: AgentConnectConnectOptions = {},
): ConnectBag<S> {
  return {
    root: {
      'data-scope': 'agent-connect',
      'data-state': (s) => get(s).status,
    },
    mintTrigger: {
      onClick: () => send({ type: 'Mint' }),
      disabled: (s) => {
        const cs = get(s)
        return cs.status === 'minting' || cs.status === 'pending-claude' || cs.status === 'active'
      },
    },
    pendingTokenBox: {
      'data-part': 'pending-token',
      'data-visible': (s) => get(s).pendingToken !== null,
    },
    copyConnectSnippetButton: {
      // The handler reads state at click time via the Msg/effect path:
      // CopyConnectSnippet → update() reads pendingToken.connectSnippet
      // → effect AgentClipboardWrite writes to navigator.clipboard.
      // Routing through update() keeps state reads out of event
      // handlers, which is what makes the static-bag-with-reactive-
      // accessors shape work cleanly.
      onClick: () => send({ type: 'CopyConnectSnippet' }),
      disabled: (s) => get(s).pendingToken === null,
    },
    sessionsList: { 'data-part': 'sessions-list' },
    sessionItem: (tid) => ({ 'data-part': 'session-item', 'data-tid': tid }),
    revokeButton: (tid) => ({ onClick: () => send({ type: 'Revoke', tid }) }),
    resumeBanner: {
      'data-part': 'resume-banner',
      'data-visible': (s) => get(s).resumable.length > 0,
    },
    resumeItem: (tid) => ({ 'data-part': 'resume-item', 'data-tid': tid }),
    resumeButton: (tid) => ({ onClick: () => send({ type: 'Resume', tid }) }),
    dismissButton: (tid) => ({
      // For dismiss, we currently just remove the resumable record
      // locally. A "dismiss forever" flag could land in a follow-up;
      // for v1, dismiss is a client-side-only state prune by reusing
      // the Revoke Msg path with intent-split; for now emit Revoke
      // which both revokes server-side AND removes locally.
      onClick: () => send({ type: 'Revoke', tid }),
    }),
    error: {
      'data-part': 'error',
      'data-visible': (s) => get(s).error !== null,
      onClick: () => send({ type: 'ClearError' }),
    },
  }
}
