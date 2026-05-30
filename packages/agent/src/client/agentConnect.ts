import { tagSend, type Send, type Signal } from '@llui/dom'
import type { AgentSession, AgentToken } from '../protocol.js'
import type { AgentEffect } from './effects.js'

export type AgentConnectStatus =
  | 'idle'
  | 'minting'
  | 'pending-claude'
  | 'active'
  | 'reconnecting'
  | 'failed'
  | 'error'

export type AgentConnectPendingToken = {
  token: AgentToken
  tid: string
  lapUrl: string
  /**
   * Natural-language connect instruction the user copies into Claude.
   * Includes URL, token, and the explicit `connect_session` tool
   * call. Works in any Claude client (Desktop, CC CLI, etc.) — the
   * Desktop-specific `/llui-connect` slash command is sugar over the
   * same tool call.
   */
  connectSnippet: string
  expiresAt: number
  /**
   * Cached so the auto-reconnect path can re-open the WS without
   * re-minting. The MintSucceeded → AgentOpenWS path stores it; the
   * RestoreSession path also fills it in. Cleared by `Disconnect`.
   */
  wsUrl: string
}

export type AgentConnectState = {
  status: AgentConnectStatus
  pendingToken: AgentConnectPendingToken | null
  sessions: AgentSession[]
  resumable: AgentSession[]
  error: { code: string; detail: string } | null
  /**
   * Reconnect attempt counter. Incremented on each WS-close that
   * triggers an auto-reconnect; reset on `WsOpened` and on user
   * actions (`Disconnect`, fresh `Mint`). Drives the backoff schedule
   * (1s, 2s, 4s, 8s, 16s, 30s, 30s, …) and surfaces to UI as
   * "reconnecting (attempt 3 / next in 4s)".
   */
  reconnectAttempt: number
  /**
   * Total cumulative ms spent in `reconnecting` for the current
   * outage. Compared against `reconnectGiveUpMs` (effect-side option,
   * default 5 min) to decide when to surface `failed` to the user.
   * Reset whenever a WS opens successfully.
   */
  reconnectElapsedMs: number
}

export type AgentConnectMsg =
  /** @intent("Mint a new agent token and open the pairing WebSocket") */
  | { type: 'Mint' }
  /**
   * @humanOnly — internal: dispatched by the AgentMintRequest effect
   * handler when the mint endpoint replies success. Carries the token
   * and connection URLs into state.
   */
  | {
      type: 'MintSucceeded'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  /** @humanOnly — internal: dispatched by the AgentMintRequest handler on failure. */
  | { type: 'MintFailed'; error: { code: string; detail: string } }
  /** @humanOnly — internal: WS adapter signalled the pairing socket is open. */
  | { type: 'WsOpened' }
  /** @humanOnly — internal: WS adapter signalled the pairing socket is closed. */
  | { type: 'WsClosed' }
  /** @humanOnly — internal: Claude bound the session via /agent/claim. */
  | { type: 'ActivatedByClaude' }
  /** @intent("Check which previously-issued agent sessions can be resumed") */
  | { type: 'ResumeList'; tids: string[] }
  /** @humanOnly — internal: AgentResumeCheck effect handler returned the list. */
  | { type: 'ResumeListLoaded'; sessions: AgentSession[] }
  /** @intent("Resume an existing agent session by tid") */
  | { type: 'Resume'; tid: string }
  /** @intent("Revoke an agent session by tid") */
  | { type: 'Revoke'; tid: string }
  /** @intent("Dismiss the current agent connect error") */
  | { type: 'ClearError' }
  /** @humanOnly — internal: AgentSessionsList effect handler returned the list. */
  | { type: 'SessionsLoaded'; sessions: AgentSession[] }
  /** @intent("Refresh the list of active agent sessions") */
  | { type: 'RefreshSessions' }
  /**
   * @intent("Copy the agent connect snippet to the clipboard")
   * Resolves the pendingToken's snippet in update() (state-reading is
   * what update() is for) and dispatches a clipboard-write effect.
   */
  | { type: 'CopyConnectSnippet' }
  /**
   * @humanOnly — internal: app boot dispatches this with credentials
   * read from sessionStorage to skip the mint round-trip after page
   * refresh. The agent's token (still alive on the server) keeps
   * working since we don't go through the rotate-on-resume path. The
   * reducer is idempotent against an in-flight Mint — only fires from
   * `idle`.
   */
  | {
      type: 'RestoreSession'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  /**
   * @intent("Disconnect the active agent session and clear all
   * persisted credentials. Stops any in-flight reconnect attempt;
   * subsequent WS closures stay in `idle` instead of triggering
   * auto-reconnect. Use when the user explicitly clicks Disconnect
   * in the panel — for transient drops, do nothing and let the
   * reconnect loop run.")
   */
  | { type: 'Disconnect' }
  /**
   * @humanOnly — internal: scheduler effect dispatched this when the
   * backoff timer fired. The reducer increments the attempt counter,
   * adds the just-elapsed delay to `reconnectElapsedMs`, and emits
   * `AgentOpenWS` with the cached pendingToken/wsUrl so the WS can
   * reattach without minting.
   */
  | { type: 'ReconnectAttempt'; elapsedMs: number }
  /**
   * @humanOnly — internal: scheduler effect dispatched this when the
   * give-up ceiling was reached without a successful WS open.
   * Reducer flips status to `failed` so the UI can surface a clear
   * error and offer a manual reconnect.
   */
  | { type: 'ReconnectGaveUp' }

/**
 * Options threaded through `init()` and `update()`. `mintUrl` is
 * optional — when omitted the agent effect handler derives it from
 * `EffectHandlerHost.agentBasePath` (default `/agent` → `/agent/mint`).
 * Set explicitly only when the mint endpoint lives outside the
 * configured base path.
 */
export type AgentConnectInitOpts = { mintUrl?: string }

/**
 * Backoff schedule for the auto-reconnect loop. Doubles starting at
 * 1s, caps at 30s. Translates `state.reconnectAttempt` into the next
 * delay; the effect handler schedules a `setTimeout` for that long
 * and dispatches `ReconnectAttempt` when it fires.
 *
 * Lives in the reducer so tests can pin the timings without poking
 * effect-handler internals; the constants are not exported because
 * tweaking them changes UX more than tweaks to the give-up ceiling.
 */
const RECONNECT_BASE_MS = 1000
const RECONNECT_CAP_MS = 30_000
function reconnectDelayMs(attempt: number): number {
  const factor = Math.min(Math.pow(2, attempt), RECONNECT_CAP_MS / RECONNECT_BASE_MS)
  return Math.min(RECONNECT_BASE_MS * factor, RECONNECT_CAP_MS)
}

/**
 * Total cumulative wait, across all reconnect attempts, before the
 * loop gives up and transitions to `'failed'`. 5 minutes is long
 * enough to weather a brief server outage but short enough that a
 * permanently-down endpoint surfaces clearly to the user instead of
 * silently spinning.
 */
const RECONNECT_GIVE_UP_MS = 5 * 60 * 1000

/**
 * Build the user-pasted connect snippet that lands in the LLM's chat
 * window. Three things in one paragraph that an LLM will follow on
 * first read:
 *
 * 1. Tell the LLM which tool to call to bind the session
 *    (`connect_session`).
 *
 * 2. Encourage `narrate` for surfacing intent during multi-step
 *    actions. Without the nudge the LLM tends to dispatch silently;
 *    with it, the user sees a running commentary in the app's
 *    activity log alongside the action entries. One-way channel
 *    (LLM → user); the conversation itself stays in the LLM's own
 *    chat window.
 *
 * 3. Survive tool-namespacing edge cases: Claude Desktop exposes MCP
 *    tools as bare names (`connect_session`) but Claude Code and
 *    other namespacing clients emit them as
 *    `mcp__llui__connect_session` and may defer-load them — so an
 *    LLM that searches its tool list for a literal name won't find
 *    it. Naming the LLui MCP server explicitly (with its canonical
 *    install name `llui`) gives the model enough to resolve the
 *    right tool on either platform; the parenthetical surfaces the
 *    edge case for deferred-tool clients.
 *
 * Phrased generically (`AI assistant`, `Some MCP clients`) since
 * MCP support is rapidly expanding past Claude — the snippet
 * shouldn't telegraph "this is Claude-only" when it works against
 * any compliant client. The framework owns this string; updates
 * ride along the `@llui/agent` package version.
 */
function buildConnectSnippet(lapUrl: string, token: string): string {
  return (
    `Connect this AI assistant to the LLui app. Call the LLui MCP server's ` +
    `\`connect_session\` tool with url=${JSON.stringify(lapUrl)} and ` +
    `token=${JSON.stringify(token)}. ` +
    `When you're working through a multi-step task, call \`narrate\` to ` +
    `surface what you're doing — the user sees your prose in the app's ` +
    `activity log alongside each action you dispatch. ` +
    `(Some MCP clients namespace tools as ` +
    `\`mcp__llui__connect_session\` / \`mcp__llui__narrate\` and load them ` +
    `lazily — search the tool list if the bare names aren't immediately ` +
    `available.)`
  )
}

/** Component shape is [State, Effect[]] — consistent with @llui/components. */
export function init(_opts: AgentConnectInitOpts): [AgentConnectState, AgentEffect[]] {
  return [
    {
      status: 'idle',
      pendingToken: null,
      sessions: [],
      resumable: [],
      error: null,
      reconnectAttempt: 0,
      reconnectElapsedMs: 0,
    },
    [],
  ]
}

export function update(
  state: AgentConnectState,
  msg: AgentConnectMsg,
  opts: AgentConnectInitOpts = {},
): [AgentConnectState, AgentEffect[]] {
  switch (msg.type) {
    case 'Mint': {
      // mintUrl: undefined means "let the effect handler derive it
      // from agentBasePath". Only include the property when explicitly
      // set, so the effect's discriminated shape stays clean.
      const mintEffect: AgentEffect =
        opts.mintUrl !== undefined
          ? { type: 'AgentMintRequest', mintUrl: opts.mintUrl }
          : { type: 'AgentMintRequest' }
      return [{ ...state, status: 'minting' }, [mintEffect]]
    }
    case 'MintSucceeded': {
      const pending: AgentConnectPendingToken = {
        token: msg.token,
        tid: msg.tid,
        lapUrl: msg.lapUrl,
        connectSnippet: buildConnectSnippet(msg.lapUrl, msg.token),
        expiresAt: msg.expiresAt,
        wsUrl: msg.wsUrl,
      }
      return [
        {
          ...state,
          status: 'pending-claude',
          pendingToken: pending,
          error: null,
          reconnectAttempt: 0,
          reconnectElapsedMs: 0,
        },
        [
          { type: 'AgentOpenWS', token: msg.token, wsUrl: msg.wsUrl },
          // Persist alongside opening the WS so the host can store the
          // credentials in sessionStorage; on page refresh, app boot
          // dispatches `RestoreSession` with the same shape and we
          // re-enter the same state without re-minting.
          {
            type: 'AgentSessionPersist',
            token: msg.token,
            tid: msg.tid,
            lapUrl: msg.lapUrl,
            wsUrl: msg.wsUrl,
            expiresAt: msg.expiresAt,
          },
        ],
      ]
    }
    case 'RestoreSession': {
      // Idempotent guard: only fires from idle. A racing Mint click
      // would already have moved us to `minting` — restoring on top
      // would clobber the in-flight pending state with stale
      // credentials read from sessionStorage. Easier to no-op here
      // than to coordinate the race in the host.
      if (state.status !== 'idle') return [state, []]
      const restored: AgentConnectPendingToken = {
        token: msg.token,
        tid: msg.tid,
        lapUrl: msg.lapUrl,
        connectSnippet: buildConnectSnippet(msg.lapUrl, msg.token),
        expiresAt: msg.expiresAt,
        wsUrl: msg.wsUrl,
      }
      return [
        {
          ...state,
          status: 'pending-claude',
          pendingToken: restored,
          error: null,
          reconnectAttempt: 0,
          reconnectElapsedMs: 0,
        },
        [{ type: 'AgentOpenWS', token: msg.token, wsUrl: msg.wsUrl }],
      ]
    }
    case 'MintFailed':
      return [{ ...state, status: 'error', error: msg.error }, []]
    case 'WsOpened': {
      // WS is open but Claude hasn't bound yet; stay at pending-claude.
      // If we were `reconnecting`, this is a successful reattach —
      // back to pending-claude and reset the attempt counters.
      if (state.status === 'reconnecting') {
        return [
          { ...state, status: 'pending-claude', reconnectAttempt: 0, reconnectElapsedMs: 0 },
          [],
        ]
      }
      return [state, []]
    }
    case 'WsClosed': {
      // Three cases:
      //   1. We had no pendingToken (already idle / pre-mint) → no-op.
      //   2. Status is `idle` or `failed` (Disconnect already cleared,
      //      or we previously gave up) → no-op so a delayed close
      //      event after Disconnect doesn't accidentally restart the
      //      loop.
      //   3. We're connected/connecting and the close was unsolicited
      //      → schedule a reconnect with backoff.
      if (state.pendingToken === null) return [{ ...state, status: 'idle' }, []]
      if (state.status === 'idle' || state.status === 'failed') return [state, []]
      const delayMs = reconnectDelayMs(state.reconnectAttempt)
      return [
        { ...state, status: 'reconnecting', error: null },
        [{ type: 'AgentReconnectSchedule', delayMs }],
      ]
    }
    case 'ReconnectAttempt': {
      // Backoff timer fired. If the user disconnected in the gap, we
      // moved to idle and ignore. Otherwise, increment attempt + add
      // the elapsed delay to the cumulative window. Past the give-up
      // ceiling, transition to `failed` so the UI can offer a manual
      // reconnect; otherwise re-open the WS with the cached
      // credentials (no mint, same token — the server's grace window
      // is what makes this transparent to the agent).
      if (state.status !== 'reconnecting' || state.pendingToken === null) {
        return [state, []]
      }
      const newElapsed = state.reconnectElapsedMs + msg.elapsedMs
      if (newElapsed >= RECONNECT_GIVE_UP_MS) {
        return [{ ...state, status: 'failed', reconnectElapsedMs: newElapsed }, []]
      }
      return [
        {
          ...state,
          reconnectAttempt: state.reconnectAttempt + 1,
          reconnectElapsedMs: newElapsed,
        },
        [
          {
            type: 'AgentOpenWS',
            token: state.pendingToken.token,
            wsUrl: state.pendingToken.wsUrl,
          },
        ],
      ]
    }
    case 'ReconnectGaveUp':
      return [{ ...state, status: 'failed' }, []]
    case 'Disconnect': {
      // User-initiated. Revoke the active tid (server kills the
      // pairing), wipe the persisted credentials so a refresh can't
      // restore them, and zero the reconnect counters so any in-
      // flight backoff timer that fires post-disconnect becomes a
      // no-op (the status guard in `ReconnectAttempt` keeps it from
      // re-opening the WS).
      const tid = state.pendingToken?.tid
      const effects: AgentEffect[] = []
      if (tid !== undefined) effects.push({ type: 'AgentRevoke', tid })
      effects.push({ type: 'AgentSessionClear' })
      effects.push({ type: 'AgentCloseWS' })
      return [
        {
          ...state,
          status: 'idle',
          pendingToken: null,
          error: null,
          reconnectAttempt: 0,
          reconnectElapsedMs: 0,
        },
        effects,
      ]
    }
    case 'ActivatedByClaude':
      return [{ ...state, status: 'active' }, []]
    case 'ResumeList':
      return [state, [{ type: 'AgentResumeCheck', tids: msg.tids }]]
    case 'ResumeListLoaded':
      return [{ ...state, resumable: msg.sessions }, []]
    case 'Resume':
      return [state, [{ type: 'AgentResumeClaim', tid: msg.tid }]]
    case 'Revoke': {
      // Optimistically remove from sessions + resumable. If the
      // revoked tid matches the currently-pending session, also fire
      // AgentSessionClear so the host wipes its persisted credentials
      // — otherwise a refresh would try to RestoreSession with a
      // server-side-revoked token and end up at an auth-failed WS.
      const isActiveTid = state.pendingToken !== null && state.pendingToken.tid === msg.tid
      const effects: AgentEffect[] = [{ type: 'AgentRevoke', tid: msg.tid }]
      if (isActiveTid) effects.push({ type: 'AgentSessionClear' })
      return [
        {
          ...state,
          sessions: state.sessions.filter((s) => s.tid !== msg.tid),
          resumable: state.resumable.filter((s) => s.tid !== msg.tid),
        },
        effects,
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
 * Static prop bag with reactive (Signal-handle) values. Mirrors the
 * @llui/components pattern (e.g. `dialog.connect`): callers spread bag
 * keys directly into element helpers, and handle-valued props re-evaluate
 * per binding-mask hit. The caller passes the `agent-connect` state slice
 * as a `Signal`; reactive props are derived from it via `state.map(...)`.
 */
export type ConnectBag = {
  root: { 'data-scope': 'agent-connect'; 'data-state': Signal<AgentConnectStatus> }
  mintTrigger: { onClick: () => void; disabled: Signal<boolean> }
  pendingTokenBox: { 'data-part': 'pending-token'; 'data-visible': Signal<boolean> }
  copyConnectSnippetButton: { onClick: () => void; disabled: Signal<boolean> }
  sessionsList: { 'data-part': 'sessions-list' }
  sessionItem: (tid: string) => { 'data-part': 'session-item'; 'data-tid': string }
  revokeButton: (tid: string) => { onClick: () => void }
  resumeBanner: { 'data-part': 'resume-banner'; 'data-visible': Signal<boolean> }
  resumeItem: (tid: string) => { 'data-part': 'resume-item'; 'data-tid': string }
  resumeButton: (tid: string) => { onClick: () => void }
  dismissButton: (tid: string) => { onClick: () => void }
  error: {
    'data-part': 'error'
    'data-visible': Signal<boolean>
    onClick: () => void
  }
}

/**
 * Builds prop bags for the view. Static-bag-with-Signal-handles shape
 * (matches the @llui/components convention); spread directly into
 * element helpers.
 */
export function connect(
  state: Signal<AgentConnectState>,
  send: Send<AgentConnectMsg>,
  _opts: AgentConnectConnectOptions = {},
): ConnectBag {
  return {
    root: {
      'data-scope': 'agent-connect',
      'data-state': state.map((s) => s.status),
    },
    mintTrigger: {
      onClick: tagSend(send, ['Mint'], () => send({ type: 'Mint' })),
      disabled: state.map(
        (s) => s.status === 'minting' || s.status === 'pending-claude' || s.status === 'active',
      ),
    },
    pendingTokenBox: {
      'data-part': 'pending-token',
      'data-visible': state.map((s) => s.pendingToken !== null),
    },
    copyConnectSnippetButton: {
      // The handler reads state at click time via the Msg/effect path:
      // CopyConnectSnippet → update() reads pendingToken.connectSnippet
      // → effect AgentClipboardWrite writes to navigator.clipboard.
      // Routing through update() keeps state reads out of event
      // handlers, which is what makes the static-bag-with-Signal-
      // handles shape work cleanly.
      onClick: tagSend(send, ['CopyConnectSnippet'], () => send({ type: 'CopyConnectSnippet' })),
      disabled: state.map((s) => s.pendingToken === null),
    },
    sessionsList: { 'data-part': 'sessions-list' },
    sessionItem: (tid) => ({ 'data-part': 'session-item', 'data-tid': tid }),
    revokeButton: (tid) => ({
      onClick: tagSend(send, ['Revoke'], () => send({ type: 'Revoke', tid })),
    }),
    resumeBanner: {
      'data-part': 'resume-banner',
      'data-visible': state.map((s) => s.resumable.length > 0),
    },
    resumeItem: (tid) => ({ 'data-part': 'resume-item', 'data-tid': tid }),
    resumeButton: (tid) => ({
      onClick: tagSend(send, ['Resume'], () => send({ type: 'Resume', tid })),
    }),
    dismissButton: (tid) => ({
      // For dismiss, we currently just remove the resumable record
      // locally. A "dismiss forever" flag could land in a follow-up;
      // for v1, dismiss is a client-side-only state prune by reusing
      // the Revoke Msg path with intent-split; for now emit Revoke
      // which both revokes server-side AND removes locally.
      onClick: tagSend(send, ['Revoke'], () => send({ type: 'Revoke', tid })),
    }),
    error: {
      'data-part': 'error',
      'data-visible': state.map((s) => s.error !== null),
      onClick: tagSend(send, ['ClearError'], () => send({ type: 'ClearError' })),
    },
  }
}
