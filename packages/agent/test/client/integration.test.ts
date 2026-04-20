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
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import { attachWsClient, type RpcHosts } from '../../src/client/ws-client.js'
import type { HelloFrame, MintResponse, LapDescribeResponse } from '../../src/protocol.js'
import type { AgentServerHandle } from '../../src/server/options.js'

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const key = 'x'.repeat(32)

let server: Server
let agent: AgentServerHandle
let store: InMemoryTokenStore
let port: number

// Node's http.Server only handles HTTP; we need to bridge fetch calls through
// to the agent's Web-fetch-style router. The server handles two things:
//   1. WS upgrades → agent.wsUpgrade
//   2. HTTP requests → agent.router (bridge via inline request handler)

beforeEach(async () => {
  store = new InMemoryTokenStore()
  agent = createLluiAgentServer({
    signingKey: key,
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

  server.on('upgrade', agent.wsUpgrade)

  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseUrl(): string {
  return `http://127.0.0.1:${port}`
}

function wsUrl(path: string): string {
  return `ws://127.0.0.1:${port}${path}`
}

function makeFakeRpcHost(state: unknown): RpcHosts {
  return {
    getState: () => state,
    send: () => {},
    flush: () => {},
    getMsgAnnotations: () => null,
    getBindingDescriptors: () => null,
    getAgentAffordances: () => null,
    getAgentContext: () => null,
    getRootElement: () => null,
    proposeConfirm: () => {},
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
          humanOnly: false,
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
    expect(body.token.startsWith('llui-agent_')).toBe(true)
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
    const ws = new WebSocket(`${wsUrl('/agent/ws')}?token=${encodeURIComponent(token)}`)
    // ws package implements the WsLike interface (addEventListener + send + close)
    const fakeRpc = makeFakeRpcHost({ value: 42 })
    attachWsClient(
      ws as unknown as import('../../src/client/ws-client.js').WsLike,
      fakeRpc,
      makeHelloBuilder('IntegrationApp'),
    )

    // 3. Wait for WS to fully open (hello has been sent at this point)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    // Small buffer: hello frame is sent synchronously on open, but the server
    // must process it before describe can return 200. Give it a brief moment.
    await new Promise((r) => setTimeout(r, 50))

    // 4. describe → should now have the hello payload
    const descRes = await fetch(`${baseUrl()}/agent/lap/v1/describe`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
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
    const ws = new WebSocket(`${wsUrl('/agent/ws')}?token=${encodeURIComponent(token)}`)
    attachWsClient(
      ws as unknown as import('../../src/client/ws-client.js').WsLike,
      makeFakeRpcHost(appState),
      makeHelloBuilder('StateApp'),
    )

    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    await new Promise((r) => setTimeout(r, 50))

    const stateRes = await fetch(`${baseUrl()}/agent/lap/v1/state`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(stateRes.status).toBe(200)
    const body = (await stateRes.json()) as { state: unknown }
    expect(body.state).toEqual(appState)

    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })
})
