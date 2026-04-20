import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createWsUpgradeHandler } from '../../../src/server/ws/upgrade.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenPayload, TokenRecord } from '../../../src/protocol.js'

const key = 'x'.repeat(32)

function seed(store: InMemoryTokenStore, tid: string): Promise<void> {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'awaiting-ws',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'http://localhost',
    label: null,
  }
  return store.create(rec)
}

let server: Server
let registry: WsPairingRegistry
let store: InMemoryTokenStore
let port = 0

beforeEach(async () => {
  registry = new WsPairingRegistry()
  store = new InMemoryTokenStore()
  server = createServer()
  const upgrade = createWsUpgradeHandler({
    signingKey: key,
    tokenStore: store,
    registry,
    auditSink: { write: () => {} },
    now: () => Date.now(),
  })
  server.on('upgrade', upgrade)
  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeToken(tid: string): string {
  const payload: TokenPayload = {
    tid,
    iat: 0,
    exp: 9_999_999_999,
    scope: 'agent',
  }
  return signToken(payload, key)
}

describe('createWsUpgradeHandler', () => {
  it('accepts a WS connection with a valid token and registers the pairing', async () => {
    await seed(store, 't1')
    const token = makeToken('t1')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
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

  it('rejects a connection with a bad-signature token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=llui-agent_bogus.sig`)
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(401)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })

  it('unregisters on socket close', async () => {
    await seed(store, 't2')
    const token = makeToken('t2')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agent/ws?token=${encodeURIComponent(token)}`)
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(registry.isPaired('t2')).toBe(false)
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
