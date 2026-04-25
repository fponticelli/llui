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
      expect(state1.pendingToken!.connectSnippet).toBe(`/llui-connect ${lapUrl} ${token}`)
      expect(state1.pendingToken!.expiresAt).toBe(expiresAt)
      expect(state1.error).toBeNull()
      expect(effects).toEqual([{ type: 'AgentOpenWS', token, wsUrl }])
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
      expect(state1.status).toBe('idle')
      expect(state1.pendingToken).toBeNull()
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
      { type: 'AgentClipboardWrite', text: `/llui-connect ${lapUrl} ${token}` },
    ])
  })

  it('CopyConnectSnippet with no pending token is a no-op', () => {
    const [s0] = init(opts)
    const [, effects] = update(s0, { type: 'CopyConnectSnippet' }, opts)
    expect(effects).toEqual([])
  })
})
