import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/client/agentConnect.js'
import type {
  AgentConnectState,
  AgentConnectMsg,
  AgentConnectInitOpts,
} from '../../src/client/agentConnect.js'
import type { AgentEffect } from '../../src/client/effects.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const token = 'llui-agent_abc.def' as import('../../src/protocol.js').AgentToken
const tid = '11111111-1111-1111-1111-111111111111'
const lapUrl = 'https://app.example/agent/lap/v1'
const wsUrl = 'wss://app.example/agent/ws'
const expiresAt = 9_999_999_999
const mintUrl = 'https://app.example/agent/mint'
const opts: AgentConnectInitOpts = { mintUrl }

const session1 = {
  tid,
  label: 'Session 1',
  status: 'active' as const,
  createdAt: 1000,
  lastSeenAt: 2000,
}
const session2 = {
  tid: '22222222-2222-2222-2222-222222222222',
  label: 'Session 2',
  status: 'pending-resume' as const,
  createdAt: 1000,
  lastSeenAt: 2000,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(state: AgentConnectState, msg: AgentConnectMsg): [AgentConnectState, AgentEffect[]] {
  return update(state, msg, opts)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agentConnect', () => {
  describe('init', () => {
    it('yields idle state with empty sessions and resumable', () => {
      const [state, effects] = init(opts)
      expect(state.status).toBe('idle')
      expect(state.pendingToken).toBeNull()
      expect(state.sessions).toEqual([])
      expect(state.resumable).toEqual([])
      expect(state.error).toBeNull()
      expect(effects).toEqual([])
    })
  })

  describe('Mint', () => {
    it('transitions idle → minting and emits AgentMintRequest', () => {
      const [state0] = init(opts)
      const [state1, effects] = send(state0, { type: 'Mint' })
      expect(state1.status).toBe('minting')
      expect(effects).toEqual([{ type: 'AgentMintRequest', mintUrl }])
    })
  })

  describe('MintSucceeded', () => {
    it('populates pendingToken, transitions to pending-claude, emits AgentOpenWS', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [state1, effects] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      expect(state1.status).toBe('pending-claude')
      expect(state1.pendingToken).not.toBeNull()
      expect(state1.pendingToken!.token).toBe(token)
      expect(state1.pendingToken!.tid).toBe(tid)
      expect(state1.pendingToken!.lapUrl).toBe(lapUrl)
      expect(state1.pendingToken!.connectSnippet).toBe(
        `Connect this AI assistant to the LLui app. Call the LLui MCP server's ` +
          `\`connect_session\` tool with url=${JSON.stringify(lapUrl)} and ` +
          `token=${JSON.stringify(token)}. ` +
          `(Some MCP clients namespace tools as ` +
          `\`mcp__llui__connect_session\` and load them lazily — search the tool list if \`connect_session\` isn't immediately available.)`,
      )
      expect(state1.pendingToken!.expiresAt).toBe(expiresAt)
      expect(state1.error).toBeNull()
      expect(effects).toEqual([
        { type: 'AgentOpenWS', token, wsUrl },
        { type: 'AgentSessionPersist', token, tid, lapUrl, wsUrl, expiresAt },
      ])
    })
  })

  describe('MintFailed', () => {
    it('transitions to error with error payload, emits no effects', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const error = { code: 'internal', detail: 'Something broke' }
      const [state1, effects] = send(minting, { type: 'MintFailed', error })
      expect(state1.status).toBe('error')
      expect(state1.error).toEqual(error)
      expect(effects).toEqual([])
    })
  })

  describe('WsOpened', () => {
    it('stays at pending-claude (browser WS is up, but Claude has not bound yet)', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [state1, effects] = send(pending, { type: 'WsOpened' })
      expect(state1.status).toBe('pending-claude')
      expect(effects).toEqual([])
    })
  })

  describe('ActivatedByClaude', () => {
    it('transitions pending-claude → active when the server signals Claude has bound', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [state1, effects] = send(pending, { type: 'ActivatedByClaude' })
      expect(state1.status).toBe('active')
      expect(effects).toEqual([])
    })
  })

  describe('WsClosed', () => {
    it('transitions active → idle and clears pendingToken', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [state1, effects] = send(active, { type: 'WsClosed' })
      // New contract: WsClosed while we have a pendingToken triggers
      // the auto-reconnect loop instead of zeroing state. See the
      // "Reconnect loop" section below for the full lifecycle.
      expect(state1.status).toBe('reconnecting')
      expect(state1.pendingToken).not.toBeNull()
      expect(effects).toEqual([{ type: 'AgentReconnectSchedule', delayMs: 1000 }])
    })

    it('stays in idle and emits no effects when WsClosed fires without a pendingToken', () => {
      // Defensive case — WS adapter fires close after Disconnect or
      // before Mint. No reconnect should be scheduled.
      const [state0] = init(opts)
      const [state1, effects] = send(state0, { type: 'WsClosed' })
      expect(state1.status).toBe('idle')
      expect(effects).toEqual([])
    })
  })

  // ── Reconnect loop ────────────────────────────────────────────
  describe('reconnect loop', () => {
    it('WsClosed → ReconnectAttempt → AgentOpenWS with the cached credentials, no mint', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [reconnecting, schedEffects] = send(active, { type: 'WsClosed' })
      expect(reconnecting.status).toBe('reconnecting')
      expect(schedEffects).toEqual([{ type: 'AgentReconnectSchedule', delayMs: 1000 }])
      // Timer fires; reducer increments attempt and re-opens the WS.
      const [retrying, retryEffects] = send(reconnecting, {
        type: 'ReconnectAttempt',
        elapsedMs: 1000,
      })
      expect(retrying.status).toBe('reconnecting')
      expect(retrying.reconnectAttempt).toBe(1)
      expect(retrying.reconnectElapsedMs).toBe(1000)
      // Same token, no AgentMintRequest — that's the whole point.
      expect(retryEffects).toEqual([{ type: 'AgentOpenWS', token, wsUrl }])
    })

    it('successful WsOpened during reconnect transitions back to pending-claude and zeros the counters', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [reconnecting] = send(active, { type: 'WsClosed' })
      const [retrying] = send(reconnecting, { type: 'ReconnectAttempt', elapsedMs: 1000 })
      const [reattached, effects] = send(retrying, { type: 'WsOpened' })
      expect(reattached.status).toBe('pending-claude')
      expect(reattached.reconnectAttempt).toBe(0)
      expect(reattached.reconnectElapsedMs).toBe(0)
      expect(effects).toEqual([])
    })

    it('backoff schedule doubles to 30s and caps there', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      // Walk through closes + retries, asserting the scheduled delay
      // each time. Running the reducer in a loop is closer to what
      // the live system does than asserting a single delay value.
      let cur = active
      const seen: number[] = []
      for (let i = 0; i < 7; i++) {
        const [s1, e1] = send(cur, { type: 'WsClosed' })
        const sched = e1.find(
          (e): e is Extract<AgentEffect, { type: 'AgentReconnectSchedule' }> =>
            (e as { type: string }).type === 'AgentReconnectSchedule',
        )
        expect(sched).toBeDefined()
        if (sched) seen.push(sched.delayMs)
        cur = send(s1, { type: 'ReconnectAttempt', elapsedMs: sched!.delayMs })[0]
      }
      // attempt 0..4 → 1s, 2s, 4s, 8s, 16s; attempt 5..6 → 30s cap.
      expect(seen).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    })

    it('gives up after the cumulative reconnect window exceeds 5 minutes', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [reconnecting] = send(active, { type: 'WsClosed' })
      // Fast-forward by reporting a single huge elapsedMs that exceeds
      // the give-up ceiling.
      const [gaveUp, effects] = send(reconnecting, {
        type: 'ReconnectAttempt',
        elapsedMs: 6 * 60 * 1000, // 6 min
      })
      expect(gaveUp.status).toBe('failed')
      expect(effects).toEqual([])
    })

    it('ReconnectAttempt is a no-op once the user disconnected (status guard)', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [reconnecting] = send(active, { type: 'WsClosed' })
      const [disconnected] = send(reconnecting, { type: 'Disconnect' })
      // Pending timer fires after the user disconnected — the reducer
      // sees status `idle` and ignores it. No new WS open.
      const [stillIdle, effects] = send(disconnected, {
        type: 'ReconnectAttempt',
        elapsedMs: 1000,
      })
      expect(stillIdle.status).toBe('idle')
      expect(effects).toEqual([])
    })
  })

  // ── Disconnect ────────────────────────────────────────────────
  describe('Disconnect', () => {
    it('revokes the active tid, clears credentials, and stops the reconnect loop', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [disconnected, effects] = send(active, { type: 'Disconnect' })
      expect(disconnected.status).toBe('idle')
      expect(disconnected.pendingToken).toBeNull()
      expect(disconnected.reconnectAttempt).toBe(0)
      expect(disconnected.reconnectElapsedMs).toBe(0)
      expect(effects).toContainEqual({ type: 'AgentRevoke', tid })
      expect(effects).toContainEqual({ type: 'AgentSessionClear' })
      expect(effects).toContainEqual({ type: 'AgentCloseWS' })
    })

    it('Disconnect during reconnecting cancels the loop on next ReconnectAttempt', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [pending] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [active] = send(pending, { type: 'ActivatedByClaude' })
      const [reconnecting] = send(active, { type: 'WsClosed' })
      const [disconnected] = send(reconnecting, { type: 'Disconnect' })
      expect(disconnected.status).toBe('idle')
      // The scheduled timer eventually fires; the message hits an
      // idle reducer and is a no-op (no new AgentOpenWS effect).
      const [stillIdle, effects] = send(disconnected, {
        type: 'ReconnectAttempt',
        elapsedMs: 1000,
      })
      expect(stillIdle.status).toBe('idle')
      expect(effects).toEqual([])
    })
  })

  describe('ResumeList', () => {
    it('emits AgentResumeCheck with the tids', () => {
      const [state0] = init(opts)
      const tids = [tid, session2.tid]
      const [state1, effects] = send(state0, { type: 'ResumeList', tids })
      expect(state1).toBe(state0)
      expect(effects).toEqual([{ type: 'AgentResumeCheck', tids }])
    })
  })

  describe('ResumeListLoaded', () => {
    it('populates resumable', () => {
      const [state0] = init(opts)
      const sessions = [session1, session2]
      const [state1, effects] = send(state0, { type: 'ResumeListLoaded', sessions })
      expect(state1.resumable).toEqual(sessions)
      expect(effects).toEqual([])
    })
  })

  describe('Resume', () => {
    it('emits AgentResumeClaim for that tid', () => {
      const [state0] = init(opts)
      const [state1, effects] = send(state0, { type: 'Resume', tid })
      expect(state1).toBe(state0)
      expect(effects).toEqual([{ type: 'AgentResumeClaim', tid }])
    })
  })

  describe('Revoke', () => {
    it('emits AgentRevoke and optimistically removes tid from sessions and resumable', () => {
      const [state0] = init(opts)
      const [withSessions] = send(state0, {
        type: 'SessionsLoaded',
        sessions: [session1, session2],
      })
      const [withResumable] = send(withSessions, { type: 'ResumeListLoaded', sessions: [session1] })
      const [state1, effects] = send(withResumable, { type: 'Revoke', tid })
      expect(state1.sessions).toEqual([session2])
      expect(state1.resumable).toEqual([])
      expect(effects).toEqual([{ type: 'AgentRevoke', tid }])
    })
  })

  describe('RefreshSessions', () => {
    it('emits AgentSessionsList', () => {
      const [state0] = init(opts)
      const [state1, effects] = send(state0, { type: 'RefreshSessions' })
      expect(state1).toBe(state0)
      expect(effects).toEqual([{ type: 'AgentSessionsList' }])
    })
  })

  describe('SessionsLoaded', () => {
    it('replaces sessions list', () => {
      const [state0] = init(opts)
      const sessions = [session1, session2]
      const [state1, effects] = send(state0, { type: 'SessionsLoaded', sessions })
      expect(state1.sessions).toEqual(sessions)
      expect(effects).toEqual([])
    })
  })

  describe('ClearError', () => {
    it('nulls out error', () => {
      const [state0] = init(opts)
      const [errState] = send(state0, {
        type: 'MintFailed',
        error: { code: 'internal', detail: 'oops' },
      })
      expect(errState.error).not.toBeNull()
      const [state1, effects] = send(errState, { type: 'ClearError' })
      expect(state1.error).toBeNull()
      expect(effects).toEqual([])
    })
  })
})

// ── connect helper tests ──────────────────────────────────────────────────────

describe('agentConnect.connect', () => {
  type ParentState = { agent: AgentConnectState }

  it('returns a static bag with reactive accessors', () => {
    const [agentState] = init(opts)
    const parentState: ParentState = { agent: agentState }
    const bag = connect<ParentState>((s) => s.agent, vi.fn())
    expect(bag.root['data-scope']).toBe('agent-connect')
    // 'data-state' is a function: (s) => string
    expect(bag.root['data-state'](parentState)).toBe('idle')
    expect(bag.mintTrigger).toBeDefined()
    expect(bag.error).toBeDefined()
  })

  it('mintTrigger.onClick dispatches Mint', () => {
    const sendFn = vi.fn()
    const bag = connect<ParentState>((s) => s.agent, sendFn)
    bag.mintTrigger.onClick()
    expect(sendFn).toHaveBeenCalledWith({ type: 'Mint' })
  })

  it('mintTrigger.disabled reflects status — false in idle', () => {
    const [agentState] = init(opts)
    const parentState: ParentState = { agent: agentState }
    const bag = connect<ParentState>((s) => s.agent, vi.fn())
    expect(bag.mintTrigger.disabled(parentState)).toBe(false)
  })

  it('mintTrigger.disabled is true during minting, pending-claude, and active', () => {
    const sendFn = vi.fn()
    const [s0] = init(opts)
    const bag = connect<ParentState>((s) => s.agent, sendFn)

    const [minting] = update(s0, { type: 'Mint' }, opts)
    expect(bag.mintTrigger.disabled({ agent: minting })).toBe(true)

    const [pending] = update(
      minting,
      { type: 'MintSucceeded', token, tid, lapUrl, wsUrl, expiresAt },
      opts,
    )
    expect(bag.mintTrigger.disabled({ agent: pending })).toBe(true)

    const [active] = update(pending, { type: 'ActivatedByClaude' }, opts)
    expect(bag.mintTrigger.disabled({ agent: active })).toBe(true)
  })

  it('mintTrigger.disabled is false in error state', () => {
    const sendFn = vi.fn()
    const [s0] = init(opts)
    const [errState] = update(
      s0,
      { type: 'MintFailed', error: { code: 'internal', detail: 'oops' } },
      opts,
    )
    const bag = connect<ParentState>((s) => s.agent, sendFn)
    expect(bag.mintTrigger.disabled({ agent: errState })).toBe(false)
  })

  it('revokeButton(tid).onClick dispatches Revoke with that tid', () => {
    const sendFn = vi.fn()
    const bag = connect<ParentState>((s) => s.agent, sendFn)
    bag.revokeButton(tid).onClick()
    expect(sendFn).toHaveBeenCalledWith({ type: 'Revoke', tid })
  })

  it('error.onClick dispatches ClearError', () => {
    const sendFn = vi.fn()
    const bag = connect<ParentState>((s) => s.agent, sendFn)
    bag.error.onClick()
    expect(sendFn).toHaveBeenCalledWith({ type: 'ClearError' })
  })

  it('copyConnectSnippetButton.onClick dispatches CopyConnectSnippet (state read happens in update)', () => {
    const sendFn = vi.fn()
    const bag = connect<ParentState>((s) => s.agent, sendFn)
    bag.copyConnectSnippetButton.onClick()
    expect(sendFn).toHaveBeenCalledWith({ type: 'CopyConnectSnippet' })
  })

  it('CopyConnectSnippet emits AgentClipboardWrite with the snippet text', () => {
    const [s0] = init(opts)
    const [pending] = update(
      s0,
      { type: 'MintSucceeded', token, tid, lapUrl, wsUrl, expiresAt },
      opts,
    )
    const [, effects] = update(pending, { type: 'CopyConnectSnippet' }, opts)
    expect(effects).toEqual([
      {
        type: 'AgentClipboardWrite',
        text:
          `Connect this AI assistant to the LLui app. Call the LLui MCP server's ` +
          `\`connect_session\` tool with url=${JSON.stringify(lapUrl)} and ` +
          `token=${JSON.stringify(token)}. ` +
          `(Some MCP clients namespace tools as ` +
          `\`mcp__llui__connect_session\` and load them lazily — search the tool list if \`connect_session\` isn't immediately available.)`,
      },
    ])
  })

  it('CopyConnectSnippet with no pending token is a no-op', () => {
    const [s0] = init(opts)
    const [, effects] = update(s0, { type: 'CopyConnectSnippet' }, opts)
    expect(effects).toEqual([])
  })

  // ── Session persistence (cross-refresh) ──────────────────────────
  // MintSucceeded emits an AgentSessionPersist effect alongside
  // AgentOpenWS so the host can store the credentials in
  // sessionStorage. On boot, RestoreSession reads them back and goes
  // straight to pending-claude with a fresh AgentOpenWS — bypassing
  // mint entirely so the agent's existing token stays valid across
  // page refresh. Revoke clears the persisted blob.

  describe('MintSucceeded persistence', () => {
    it('emits AgentSessionPersist alongside AgentOpenWS', () => {
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [, effects] = send(minting, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      expect(effects).toContainEqual({ type: 'AgentOpenWS', token, wsUrl })
      expect(effects).toContainEqual({
        type: 'AgentSessionPersist',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
    })
  })

  describe('RestoreSession', () => {
    it('populates pendingToken from idle and emits AgentOpenWS without minting', () => {
      const [state0] = init(opts)
      const [state1, effects] = send(state0, {
        type: 'RestoreSession',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      expect(state1.status).toBe('pending-claude')
      expect(state1.pendingToken).not.toBeNull()
      expect(state1.pendingToken!.token).toBe(token)
      expect(state1.pendingToken!.tid).toBe(tid)
      expect(state1.pendingToken!.lapUrl).toBe(lapUrl)
      expect(state1.pendingToken!.expiresAt).toBe(expiresAt)
      // The connect snippet is regenerated with the same lapUrl/token
      // so a user who hits the panel post-refresh can still re-paste
      // the snippet (e.g. if their AI lost its tool memory).
      expect(state1.pendingToken!.connectSnippet).toContain(`url=${JSON.stringify(lapUrl)}`)
      expect(state1.pendingToken!.connectSnippet).toContain(`token=${JSON.stringify(token)}`)
      // Only the WS-open effect — no mint round-trip and no second
      // persist (the host already has these credentials, that's where
      // they came from).
      expect(effects).toEqual([{ type: 'AgentOpenWS', token, wsUrl }])
    })

    it('does not clobber an in-flight mint (idempotent guard)', () => {
      // If RestoreSession races with a manual Mint click, the mint
      // path takes precedence — restoring on top would put stale
      // credentials into pendingToken and confuse the WS opener.
      // Treat as no-op when status is anything other than idle.
      const [state0] = init(opts)
      const [minting] = send(state0, { type: 'Mint' })
      const [state1, effects] = send(minting, {
        type: 'RestoreSession',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      expect(state1).toBe(minting)
      expect(effects).toEqual([])
    })
  })

  describe('Revoke clears persisted session', () => {
    it('emits AgentSessionClear alongside AgentRevoke when revoking the active tid', () => {
      const [state0] = init(opts)
      const [pending] = send(state0, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const [, effects] = send(pending, { type: 'Revoke', tid })
      expect(effects).toContainEqual({ type: 'AgentRevoke', tid })
      expect(effects).toContainEqual({ type: 'AgentSessionClear' })
    })

    it('does NOT clear when revoking a different tid (the pending session stays)', () => {
      const [state0] = init(opts)
      const [pending] = send(state0, {
        type: 'MintSucceeded',
        token,
        tid,
        lapUrl,
        wsUrl,
        expiresAt,
      })
      const otherTid = '99999999-9999-9999-9999-999999999999'
      const [, effects] = send(pending, { type: 'Revoke', tid: otherTid })
      expect(effects).toContainEqual({ type: 'AgentRevoke', tid: otherTid })
      expect(effects).not.toContainEqual({ type: 'AgentSessionClear' })
    })
  })
})
