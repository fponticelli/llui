import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLluiAgentCore } from '../../../src/server/core.js'
import { handleCloudflareUpgrade, handleDenoUpgrade } from '../../../src/server/web/upgrade.js'

// The platform globals these handlers reach for (`WebSocketPair` on Cloudflare,
// `Deno.upgradeWebSocket` on Deno) are runtime-provided values the handlers
// must CHECK, not assume: a missing global or one of an unexpected shape is a
// 501, never a TypeError thrown out of the request handler.

type Listener = (ev: { data?: unknown }) => void

function fakeSocket(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, Listener[]>()
  return {
    sent: [] as string[],
    closed: 0,
    send(data: string) {
      this.sent.push(data)
    },
    close() {
      this.closed++
    },
    addEventListener(type: string, cb: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb])
    },
    emit(type: string, data?: unknown) {
      for (const cb of listeners.get(type) ?? []) cb({ data })
    },
    ...extra,
  }
}

function upgradeRequest(token = 'not-a-real-token'): Request {
  return new Request(`https://app.test/agent/ws?token=${token}`, {
    headers: { upgrade: 'websocket' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleCloudflareUpgrade', () => {
  it('answers 501 when the runtime has no WebSocketPair', async () => {
    const res = await handleCloudflareUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(res.status).toBe(501)
  })

  it('accepts the server half, then closes it when the token is rejected', async () => {
    const client = fakeSocket()
    let accepted = 0
    const server = fakeSocket({
      accept() {
        accepted++
      },
    })
    vi.stubGlobal(
      'WebSocketPair',
      class {
        0 = client
        1 = server
      },
    )
    const res = await handleCloudflareUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(accepted).toBe(1)
    expect(res.status).toBe(401)
    expect(server.closed).toBe(1)
  })

  it('answers 501 when the pair has no Cloudflare server half (no accept())', async () => {
    const client = fakeSocket()
    const server = fakeSocket()
    vi.stubGlobal(
      'WebSocketPair',
      class {
        0 = client
        1 = server
      },
    )
    const res = await handleCloudflareUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(res.status).toBe(501)
  })

  it('answers 501 when WebSocketPair is not a constructor', async () => {
    vi.stubGlobal('WebSocketPair', { notA: 'constructor' })
    const res = await handleCloudflareUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(res.status).toBe(501)
  })
})

describe('handleDenoUpgrade', () => {
  it('answers 501 when the runtime has no Deno.upgradeWebSocket', async () => {
    const res = await handleDenoUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(res.status).toBe(501)
  })

  it("returns Deno's own response and validates the token once the socket opens", async () => {
    const socket = fakeSocket()
    const response = new Response('deno-upgrade', { status: 200 })
    const seen: Request[] = []
    vi.stubGlobal('Deno', {
      upgradeWebSocket(req: Request) {
        seen.push(req)
        return { socket, response }
      },
    })
    const agent = createLluiAgentCore()
    const accept = vi.spyOn(agent, 'acceptConnection')
    const req = upgradeRequest('tok-123')
    const res = await handleDenoUpgrade(req, agent)
    expect(res).toBe(response)
    expect(seen).toEqual([req])
    expect(accept).not.toHaveBeenCalled()
    socket.emit('open')
    expect(accept).toHaveBeenCalledTimes(1)
    expect(accept.mock.calls[0]![0]).toBe('tok-123')
  })

  it('answers 501 when Deno.upgradeWebSocket returns an unexpected shape', async () => {
    vi.stubGlobal('Deno', { upgradeWebSocket: () => ({ socket: {}, response: 'nope' }) })
    const res = await handleDenoUpgrade(upgradeRequest(), createLluiAgentCore())
    expect(res.status).toBe(501)
  })
})
