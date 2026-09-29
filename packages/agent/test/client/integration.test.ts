/**
 * Integration test: mint → WS open → describe → state round-trip.
 *
 * Spins up a real Node HTTP server bound to an ephemeral port with
 * `createLluiAgentServer`. Uses `fetch` and the `ws` package WebSocket
 * to exercise the full path without any mocking of transport.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import { attachWsClient, type RpcHosts } from '../../src/client/ws-client.js'
import type { HelloFrame, MintResponse, LapDescribeResponse } from '../../src/protocol.js'
import type { AgentServerHandle } from '../../src/server/options.js'

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let server: Server
let agent: AgentServerHandle
let store: InMemoryTokenStore
let port: number

/**
 * Every socket this file opens, tracked on BOTH sides of the handshake so
 * teardown can hard-close whatever a test left behind (#191).
 *
 * This teardown previously called `server.closeAllConnections()` and claimed
 * that stopped a live socket from hanging the hook. For an UPGRADED socket it
 * does not: the server stops tracking it at upgrade, so neither
 * `closeAllConnections()` nor `closeIdleConnections()` reaches it and
 * `server.close()`'s callback still never fires — measured directly. (It IS
 * the right fix for a live plain-HTTP stream, which is the sibling case in the
 * notes/capture fixtures.) Both tests below assert BETWEEN `open` and their own
 * `ws.close()`, so any failed assertion left the socket open and the hook
 * waited forever. Under the `retry: 2` these tests used to carry, that was three
 * consecutive hook timeouts: one broken assertion cost 180 s to report against
 * a 60 s budget.
 */
const clients: WebSocket[] = []
const serverSockets: Duplex[] = []

// Node's http.Server only handles HTTP; we need to bridge fetch calls through
// to the agent's Web-fetch-style router. The server handles two things:
//   1. WS upgrades → agent.wsUpgrade
//   2. HTTP requests → agent.router (bridge via inline request handler)

beforeEach(async () => {
  store = new InMemoryTokenStore()
  agent = createLluiAgentServer({
    tokenStore: store,
    identityResolver: async () => 'u1',
    auditSink: { write: () => {} },
  })

  server = createServer(async (req, res) => {
    const url = `http://localhost${req.url ?? '/'}`
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v.join(', ')
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

    const request = new Request(url, {
      method: req.method ?? 'GET',
      headers,
      body: body && body.length > 0 ? body : undefined,
    })

    const response = await agent.router(request)
    if (!response) {
      res.writeHead(404)
      res.end()
      return
    }

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    const resBody = await response.arrayBuffer()
    res.end(Buffer.from(resBody))
  })

  // Tracked first, so teardown owns the raw socket even for handshakes the
  // agent's own handler rejects and destroys.
  server.on('upgrade', (_req, socket) => {
    serverSockets.push(socket)
  })
  server.on('upgrade', agent.wsUpgrade)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  // Hard-close every tracked socket BEFORE awaiting the graceful close. This
  // has to hold the sockets itself — see the note on `clients` above for why
  // `closeAllConnections()` cannot do it.
  for (const ws of clients.splice(0)) ws.terminate()
  for (const socket of serverSockets.splice(0)) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/**
 * Open a tracked client socket. The no-op `'error'` listener is required, not
 * defensive: `terminate()` on a socket that is still CONNECTING emits an
 * `'error'` ("WebSocket was closed before the connection was established"),
 * and with no listener attached `ws` re-emits it as an unhandled exception —
 * which vitest reports as a possible false positive, on the very teardown path
 * that exists to make failures report cleanly.
 */
function connect(path: string, token: string): WebSocket {
  const ws = new WebSocket(`${wsUrl(path)}?token=${encodeURIComponent(token)}`)
  ws.on('error', () => {})
  clients.push(ws)
  return ws
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return `http://127.0.0.1:${port}`
}

function wsUrl(path: string): string {
  return `ws://127.0.0.1:${port}${path}`
}

/** POST a LAP endpoint once, authenticated with `token`. */
function lapPost(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

/**
 * Resolve when the server ACKNOWLEDGES the client's `hello` — the observable
 * event that the pairing is ready, not a guess at when it might be.
 *
 * After the socket opens, the server still has to receive and record the
 * `hello` frame; until it has, `describe`/`state` answer 503 `paused`. These
 * tests used to POLL for the 200 against a private 10 s deadline, under
 * `retry: 2`. The registry records the hello and answers `hello-ack` in the
 * same synchronous step (`PairingRegistry.dispatch`), so once the ack is on the
 * client, one request is enough — and a server that never pairs fails with the
 * test's own budget instead of a hand-picked one.
 *
 * Call it BEFORE the socket opens: the listener must be attached before the
 * ack can arrive.
 */
function helloAck(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMessage = (raw: unknown): void => {
      let frame: unknown
      try {
        frame = JSON.parse(String(raw))
      } catch {
        return
      }
      if (
        typeof frame === 'object' &&
        frame !== null &&
        (frame as { t?: unknown }).t === 'hello-ack'
      ) {
        ws.off('message', onMessage)
        ws.off('close', onClose)
        resolve()
      }
    }
    const onClose = (): void => {
      ws.off('message', onMessage)
      reject(new Error('socket closed before the server acknowledged hello'))
    }
    ws.on('message', onMessage)
    ws.once('close', onClose)
  })
}

function makeFakeRpcHost(state: unknown): RpcHosts {
  return {
    getState: () => state,
    send: () => {},
    flush: () => {},
    subscribe: () => () => {},
    getAndClearDrainErrors: () => [],
    getMsgAnnotations: () => null,
    getMsgSchema: () => null,
    getBindingDescriptors: () => null,
    getAgentAffordances: () => null,
    getAgentContext: () => null,
    getRootElement: () => null,
    proposeConfirm: () => {},
    runReducer: () => null,
  }
}

function makeHelloBuilder(appName: string): () => HelloFrame {
  return (): HelloFrame => ({
    t: 'hello',
    appName,
    appVersion: '1.0.0',
    msgSchema: {
      ping: {
        payloadSchema: {},
        annotations: {
          intent: 'Ping the app',
          alwaysAffordable: true,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      },
    },
    stateSchema: { value: 'number' },
    affordancesSample: [],
    docs: { purpose: 'Integration test app' },
    schemaHash: 'testhash1',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration: mint → ws → describe → state', () => {
  it('mint returns a valid token with wsUrl + lapUrl', async () => {
    const res = await fetch(`${baseUrl()}/agent/mint`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    expect(typeof body.token).toBe('string')
    expect(body.token.startsWith('agt_')).toBe(true)
    expect(typeof body.wsUrl).toBe('string')
    expect(typeof body.lapUrl).toBe('string')
  })

  it('describe returns 503 paused when no WS is connected', async () => {
    const mintRes = await fetch(`${baseUrl()}/agent/mint`, { method: 'POST' })
    const { token } = (await mintRes.json()) as MintResponse

    const descRes = await fetch(`${baseUrl()}/agent/lap/v1/describe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(descRes.status).toBe(503)
    const body = (await descRes.json()) as { error: { code: string } }
    expect(body.error.code).toBe('paused')
  })

  it('describe returns 200 with hello payload after WS connects and sends hello', async () => {
    // 1. Mint
    const mintRes = await fetch(`${baseUrl()}/agent/mint`, { method: 'POST' })
    expect(mintRes.status).toBe(200)
    const { token } = (await mintRes.json()) as MintResponse

    // 2. Open WS + wire attachWsClient so it sends hello on open
    const ws = connect('/agent/ws', token)
    const acked = helloAck(ws)
    // ws package implements the WsLike interface (addEventListener + send + close)
    const fakeRpc = makeFakeRpcHost({ value: 42 })
    attachWsClient(
      ws as unknown as import('../../src/client/ws-client.js').WsLike,
      fakeRpc,
      makeHelloBuilder('IntegrationApp'),
    )

    // 3. Wait until the server has RECORDED the hello (it acks in the same step).
    await acked

    // 4. describe → the hello payload, on the first request.
    const descRes = await lapPost('/agent/lap/v1/describe', token)
    expect(descRes.status).toBe(200)
    const body = (await descRes.json()) as LapDescribeResponse
    expect(body.name).toBe('IntegrationApp')
    expect(body.schemaHash).toBe('testhash1')
    expect(body.docs?.purpose).toBe('Integration test app')
    expect(typeof body.messages['ping']).toBe('object')

    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it("state returns the rpc host's current state", async () => {
    // Mint + connect WS
    const mintRes = await fetch(`${baseUrl()}/agent/mint`, { method: 'POST' })
    const { token } = (await mintRes.json()) as MintResponse

    const appState = { value: 99, label: 'hello' }
    const ws = connect('/agent/ws', token)
    const acked = helloAck(ws)
    attachWsClient(
      ws as unknown as import('../../src/client/ws-client.js').WsLike,
      makeFakeRpcHost(appState),
      makeHelloBuilder('StateApp'),
    )

    await acked

    const stateRes = await lapPost('/agent/lap/v1/state', token)
    expect(stateRes.status).toBe(200)
    const body = (await stateRes.json()) as { state: unknown }
    expect(body.state).toEqual(appState)

    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })
})
