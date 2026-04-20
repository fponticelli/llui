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
  }
}

// ── Connect helper ────────────────────────────────────────────────────────────

export type AgentConnectConnectOptions = {
  id?: string // optional DOM id prefix
}

type ConnectBag = {
  root: { 'data-scope': string; 'data-state': string }
  mintTrigger: { onClick: () => void; disabled: boolean }
  pendingTokenBox: { 'data-part': string; 'data-visible': boolean }
  copyConnectSnippetButton: { onClick: () => void; disabled: boolean }
  sessionsList: { 'data-part': string }
  sessionItem: (tid: string) => { 'data-part': string; 'data-tid': string }
  revokeButton: (tid: string) => { onClick: () => void }
  resumeBanner: { 'data-part': string; 'data-visible': boolean }
  resumeItem: (tid: string) => { 'data-part': string; 'data-tid': string }
  resumeButton: (tid: string) => { onClick: () => void }
  dismissButton: (tid: string) => { onClick: () => void }
  error: { 'data-part': string; 'data-visible': boolean; onClick: () => void }
}

/**
 * Builds prop bags for the view. See spec §9.1 and the @llui/components
 * dialog.ts pattern.
 */
export function connect<S>(
  get: (s: S) => AgentConnectState,
  send: Send<AgentConnectMsg>,
  _opts: AgentConnectConnectOptions = {},
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    return {
      root: { 'data-scope': 'agent-connect', 'data-state': s.status },
      mintTrigger: {
        onClick: () => send({ type: 'Mint' }),
        disabled: s.status === 'minting' || s.status === 'pending-claude' || s.status === 'active',
      },
      pendingTokenBox: { 'data-part': 'pending-token', 'data-visible': s.pendingToken !== null },
      copyConnectSnippetButton: {
        onClick: () => {
          if (s.pendingToken && typeof navigator !== 'undefined' && 'clipboard' in navigator) {
            void navigator.clipboard.writeText(s.pendingToken.connectSnippet)
          }
        },
        disabled: s.pendingToken === null,
      },
      sessionsList: { 'data-part': 'sessions-list' },
      sessionItem: (tid) => ({ 'data-part': 'session-item', 'data-tid': tid }),
      revokeButton: (tid) => ({ onClick: () => send({ type: 'Revoke', tid }) }),
      resumeBanner: { 'data-part': 'resume-banner', 'data-visible': s.resumable.length > 0 },
      resumeItem: (tid) => ({ 'data-part': 'resume-item', 'data-tid': tid }),
      resumeButton: (tid) => ({ onClick: () => send({ type: 'Resume', tid }) }),
      dismissButton: (tid) => ({
        // For dismiss, we currently just remove the resumable record locally.
        // A "dismiss forever" flag could land in a follow-up; for v1, dismiss
        // is a client-side-only state prune by reusing the Revoke Msg path
        // with intent-split; for now Emit Revoke which both revokes server-side
        // AND removes locally. Alternative: emit a new DismissResume msg —
        // spec §9.1 lists dismissButton but doesn't spell out the emitted msg.
        // V1 pragmatic choice: same as revoke (mark revoked on server).
        onClick: () => send({ type: 'Revoke', tid }),
      }),
      error: {
        'data-part': 'error',
        'data-visible': s.error !== null,
        onClick: () => send({ type: 'ClearError' }),
      },
    }
  }
}
