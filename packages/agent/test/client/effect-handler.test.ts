import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEffectHandler, type EffectHandlerHost } from '../../src/client/effect-handler.js'
import type { AgentEffect } from '../../src/client/effects.js'
import type { AgentToken } from '../../src/protocol.js'

const TEST_ORIGIN = 'http://localhost:3000'

function mockLocation(origin: string): () => void {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    value: { origin },
    writable: true,
    configurable: true,
  })
  return () => {
    if (prev) {
      Object.defineProperty(globalThis, 'location', prev)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).location
    }
  }
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function makeHost(overrides: Partial<EffectHandlerHost> = {}): EffectHandlerHost {
  return {
    send: overrides.send ?? vi.fn(),
    wrapAgentConnect: overrides.wrapAgentConnect ?? ((m) => ({ type: 'AgentMsg', inner: m })),
    forward: overrides.forward ?? vi.fn(),
    fetch: overrides.fetch,
    openWs: overrides.openWs ?? vi.fn(),
    closeWs: overrides.closeWs ?? vi.fn(),
    // Optional fields — pass through verbatim. (Default-by-?? loses the
    // host's "didn't set this" intent for fields whose absence is
    // semantically meaningful, e.g. wrapAgentAttention's graceful-no-op.)
    wrapAgentAttention: overrides.wrapAgentAttention,
    wrapAgentChat: overrides.wrapAgentChat,
    getWsClient: overrides.getWsClient,
    sessionStorage: overrides.sessionStorage,
    agentBasePath: overrides.agentBasePath,
  }
}

describe('createEffectHandler', () => {
  let restoreLocation: (() => void) | null = null

  beforeEach(() => {
    restoreLocation = mockLocation(TEST_ORIGIN)
  })

  afterEach(() => {
    restoreLocation?.()
    restoreLocation = null
  })

  it('AgentMintRequest success → dispatches MintSucceeded via send', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => ({ wrapped: m }))
    const mintBody = {
      token: 'tok' as AgentToken,
      tid: 'tid1',
      lapUrl: 'http://localhost:3000/lap',
      wsUrl: 'ws://localhost:3000/ws',
      expiresAt: 9999,
    }
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(mintBody))
    const host = makeHost({ send, wrapAgentConnect, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentMintRequest', mintUrl: 'http://localhost:3000/agent/mint' })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/agent/mint',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(wrapAgentConnect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MintSucceeded', token: 'tok' }),
    )
    expect(send).toHaveBeenCalledOnce()
  })

  it('AgentMintRequest HTTP error → dispatches MintFailed with http-<status> code', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => m)
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ error: 'denied' }, 403))
    const host = makeHost({ send, wrapAgentConnect, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentMintRequest', mintUrl: 'http://localhost:3000/agent/mint' })

    expect(wrapAgentConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MintFailed',
        error: expect.objectContaining({ code: 'http-403' }),
      }),
    )
    expect(send).toHaveBeenCalledOnce()
  })

  it('AgentMintRequest network failure → dispatches MintFailed with code "network"', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => m)
    const mockFetch = vi.fn().mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'))
    const host = makeHost({ send, wrapAgentConnect, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentMintRequest', mintUrl: 'http://localhost:3000/agent/mint' })

    expect(wrapAgentConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MintFailed',
        error: expect.objectContaining({ code: 'network' }),
      }),
    )
  })

  it('AgentOpenWS → calls host.openWs with token + wsUrl', async () => {
    const openWs = vi.fn()
    const host = makeHost({ openWs })
    const handle = createEffectHandler(host)

    const effect: AgentEffect = {
      type: 'AgentOpenWS',
      token: 'mytoken' as AgentToken,
      wsUrl: 'ws://localhost:3000/ws',
    }
    await handle(effect)

    expect(openWs).toHaveBeenCalledWith('mytoken', 'ws://localhost:3000/ws')
  })

  it('AgentCloseWS → calls host.closeWs', async () => {
    const closeWs = vi.fn()
    const host = makeHost({ closeWs })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentCloseWS' })

    expect(closeWs).toHaveBeenCalledOnce()
  })

  it('AgentResumeCheck → POST /agent/resume/list, dispatches ResumeListLoaded', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => m)
    const sessions = [
      { tid: 't1', label: 'session', status: 'active' as const, createdAt: 0, lastSeenAt: 0 },
    ]
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ sessions }))
    const host = makeHost({ send, wrapAgentConnect, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentResumeCheck', tids: ['t1'] })

    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_ORIGIN}/agent/resume/list`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tids: ['t1'] }) }),
    )
    expect(wrapAgentConnect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ResumeListLoaded', sessions }),
    )
  })

  it('AgentResumeClaim → POST /agent/resume/claim, calls openWs + dispatches WsOpened', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => m)
    const openWs = vi.fn()
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        makeJsonResponse({ token: 'newtoken' as AgentToken, wsUrl: 'ws://localhost/ws' }),
      )
    const host = makeHost({ send, wrapAgentConnect, openWs, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentResumeClaim', tid: 't1' })

    expect(openWs).toHaveBeenCalledWith('newtoken', 'ws://localhost/ws')
    expect(wrapAgentConnect).toHaveBeenCalledWith({ type: 'WsOpened' })
  })

  it('AgentRevoke → POST /agent/revoke, no send call', async () => {
    const send = vi.fn()
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ status: 'revoked' }))
    const host = makeHost({ send, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentRevoke', tid: 't1' })

    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_ORIGIN}/agent/revoke`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('AgentSessionsList → GET /agent/sessions, dispatches SessionsLoaded', async () => {
    const send = vi.fn()
    const wrapAgentConnect = vi.fn((m) => m)
    const sessions = [
      { tid: 't2', label: 'sess', status: 'active' as const, createdAt: 0, lastSeenAt: 0 },
    ]
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ sessions }))
    const host = makeHost({ send, wrapAgentConnect, fetch: mockFetch })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentSessionsList' })

    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_ORIGIN}/agent/sessions`,
      expect.objectContaining({ method: 'GET' }),
    )
    expect(wrapAgentConnect).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SessionsLoaded', sessions }),
    )
  })

  it('AgentForwardMsg → calls host.forward with payload', async () => {
    const forward = vi.fn()
    const host = makeHost({ forward })
    const handle = createEffectHandler(host)

    const payload = { type: 'UserClicked', x: 42 }
    await handle({ type: 'AgentForwardMsg', payload })

    expect(forward).toHaveBeenCalledWith(payload)
  })

  it('AgentAttentionFlashTimeout → dispatches Clear { entryId } after delayMs via wrapAgentAttention', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn()
      const wrapAgentAttention = vi.fn((m) => ({ wrapped: m }))
      const host = makeHost({ send, wrapAgentAttention })
      const handle = createEffectHandler(host)

      // Fire-and-forget the effect; the handler awaits an internal timer.
      const done = handle({
        type: 'AgentAttentionFlashTimeout',
        entryId: 'e1',
        delayMs: 600,
      } satisfies AgentEffect)

      // Before the timer elapses: nothing dispatched.
      await Promise.resolve()
      expect(send).not.toHaveBeenCalled()

      // Advance the clock past the delay; the awaited timer resolves.
      await vi.advanceTimersByTimeAsync(600)
      await done

      expect(wrapAgentAttention).toHaveBeenCalledWith({ type: 'Clear', entryId: 'e1' })
      expect(send).toHaveBeenCalledWith({ wrapped: { type: 'Clear', entryId: 'e1' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('AgentAttentionFlashTimeout no-ops when wrapAgentAttention is not wired (graceful degradation)', async () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn()
      // No wrapAgentAttention on the host — the host opted out of the
      // attention slice. The handler should never dispatch.
      const host = makeHost({ send })
      const handle = createEffectHandler(host)

      await handle({
        type: 'AgentAttentionFlashTimeout',
        entryId: 'e1',
        delayMs: 600,
      })
      await vi.advanceTimersByTimeAsync(2_000)

      expect(send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('AgentChatSendInput → calls WsClient.submitUserInput and dispatches SubmitComplete', async () => {
    const send = vi.fn()
    const wrapAgentChat = vi.fn((m) => ({ wrapped: m }))
    const submitUserInput = vi.fn()
    const host = makeHost({
      send,
      wrapAgentChat,
      getWsClient: () => ({ submitUserInput }),
    })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentChatSendInput', text: 'hi', at: 1234 })

    expect(submitUserInput).toHaveBeenCalledWith('hi', 1234)
    expect(wrapAgentChat).toHaveBeenCalledWith({ type: 'SubmitComplete' })
    expect(send).toHaveBeenCalledWith({ wrapped: { type: 'SubmitComplete' } })
  })

  it('AgentChatSendInput still dispatches SubmitComplete even when WS client is null (graceful degradation)', async () => {
    // The session might be paused / mid-reconnect; the input field
    // would lock up forever without the SubmitComplete fallback.
    const send = vi.fn()
    const wrapAgentChat = vi.fn((m) => m)
    const host = makeHost({
      send,
      wrapAgentChat,
      getWsClient: () => null,
    })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentChatSendInput', text: 'hi', at: 1234 })

    expect(send).toHaveBeenCalledWith({ type: 'SubmitComplete' })
  })

  it('AgentChatSendInput swallows submitUserInput throws and still dispatches SubmitComplete', async () => {
    const send = vi.fn()
    const wrapAgentChat = vi.fn((m) => m)
    const submitUserInput = vi.fn(() => {
      throw new Error('socket closed')
    })
    const host = makeHost({
      send,
      wrapAgentChat,
      getWsClient: () => ({ submitUserInput }),
    })
    const handle = createEffectHandler(host)

    await expect(
      handle({ type: 'AgentChatSendInput', text: 'hi', at: 1234 }),
    ).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledWith({ type: 'SubmitComplete' })
  })

  it('AgentChatSendInput no-ops when wrapAgentChat is not wired (host opted out of chat)', async () => {
    const send = vi.fn()
    const submitUserInput = vi.fn()
    // No wrapAgentChat: host doesn't render the composer.
    const host = makeHost({ send, getWsClient: () => ({ submitUserInput }) })
    const handle = createEffectHandler(host)

    await handle({ type: 'AgentChatSendInput', text: 'hi', at: 1234 })

    // Frame still sent (any agent listening upstream gets the message)
    expect(submitUserInput).toHaveBeenCalledWith('hi', 1234)
    // …but no SubmitComplete bounces back, since there's no slice to receive it.
    expect(send).not.toHaveBeenCalled()
  })
})
