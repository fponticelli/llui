import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createWsUpgradeHandler } from '../../../src/server/ws/upgrade.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { createLluiAgentCore } from '../../../src/server/core.js'
import { seedToken } from '../_token-helper.js'

let server: Server
let registry: WsPairingRegistry
let store: InMemoryTokenStore
let port = 0

// Build the handler over a real core so it exercises the shared
// `acceptConnection` auth path (revoke / sliding-TTL / grace), with an
// optional CSWSH origin allowlist.
function startServer(corsOrigins?: readonly string[]): Promise<void> {
  registry = new WsPairingRegistry()
  store = new InMemoryTokenStore()
  const core = createLluiAgentCore({
    tokenStore: store,
    registry,
    auditSink: { write: () => {} },
    corsOrigins,
  })
  server = createServer()
  const upgrade = createWsUpgradeHandler({
    acceptConnection: core.acceptConnection,
    corsOrigins: core.allowedOrigins,
  })
  server.on('upgrade', upgrade)
  return new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port
      resolve()
    }),
  )
}

// `acceptConnection` registers the pairing asynchronously (after the
// socket `open` fires), so poll briefly rather than asserting inline.
async function waitForPaired(tid: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (registry.isPaired(tid)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeEach(async () => {
  await startServer()
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('createWsUpgradeHandler', () => {
  it('accepts a WS connection with a valid token and registers the pairing', async () => {
    const { token } = await seedToken(store, { tid: 't1', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    await waitForPaired('t1')
    expect(registry.isPaired('t1')).toBe(true)
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it('rejects a connection with a missing token (401 Unauthorized)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })

  it('rejects an unknown opaque token (closes without a usable pairing)', async () => {
    // Token validity is verified through the shared `acceptConnection`
    // path (the single source of truth for revoke / sliding-TTL /
    // grace), which runs just after the handshake — so an unknown token
    // ends as an immediately-closed socket that never registers a
    // pairing, rather than a pre-handshake 401. Well-formed prefix, but
    // no record in the store maps to this hash.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=agt_unknown`)
    await new Promise<void>((resolve) => {
      ws.on('close', () => resolve())
      ws.on('unexpected-response', () => {
        ws.terminate()
        resolve()
      })
      ws.on('error', () => resolve())
    })
    expect(ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING).toBe(true)
  })

  it('unregisters on socket close', async () => {
    const { token } = await seedToken(store, { tid: 't2', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(registry.isPaired('t2')).toBe(false)
  })

  it('transitions token status to awaiting-claude on WS connect', async () => {
    const { token } = await seedToken(store, { tid: 't3', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    // Give the server-side handler a tick to call markAwaitingClaude
    await new Promise((resolve) => setTimeout(resolve, 10))
    const rec = await store.findByTid('t3')
    expect(rec?.status).toBe('awaiting-claude')
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it('rejects a cross-origin handshake (CSWSH, 403)', async () => {
    // A browser always sends Origin; a foreign Origin with no allowlist
    // configured must be rejected as same-origin-only.
    const { token } = await seedToken(store, { tid: 'tco', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`, {
      headers: { origin: 'http://evil.example' },
    })
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(403)
        resolve()
      })
      ws.on('error', () => resolve())
    })
    expect(registry.isPaired('tco')).toBe(false)
  })

  it('accepts a same-origin handshake', async () => {
    const { token } = await seedToken(store, { tid: 'tso', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    })
    await new Promise<void>((resolve) => ws.once('open', resolve))
    await waitForPaired('tso')
    expect(registry.isPaired('tso')).toBe(true)
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it('accepts an allowlisted cross-origin handshake when corsOrigins is set', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await startServer(['http://trusted.example'])
    const { token } = await seedToken(store, { tid: 'tal', uid: 'u1', status: 'awaiting-ws' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`, {
      headers: { origin: 'http://trusted.example' },
    })
    await new Promise<void>((resolve) => ws.once('open', resolve))
    await waitForPaired('tal')
    expect(registry.isPaired('tal')).toBe(true)
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  })

  it('ignores non /agent/ws upgrade paths', async () => {
    // Send a GET with Upgrade to /other → handler should do nothing; connection hangs.
    // Simulate by trying to upgrade a different path and asserting the socket closes.
    // Simplified: the handler only runs on `server.on('upgrade')` dispatched events, so
    // an upgrade to /other would reach the handler too — but the handler's first check
    // is the path. Test by sending to `/other` and expecting 404/close.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/other?token=x`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(404)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })
})
