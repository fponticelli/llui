import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket, type ClientOptions } from 'ws'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { createWsUpgradeHandler } from '../../../src/server/ws/upgrade.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { createLluiAgentCore } from '../../../src/server/core.js'
import { seedToken } from '../_token-helper.js'

let server: Server
let registry: WsPairingRegistry
let store: InMemoryTokenStore
let port = 0

/**
 * Every socket this file opens, tracked on BOTH sides of the handshake so
 * teardown can hard-close whatever a test left behind (#191).
 *
 * `http.Server#close()` does not invoke its callback while any connection is
 * still live, and a connection that has been UPGRADED is no longer reachable
 * from `closeAllConnections()` either (measured: the callback still never
 * fires) — so a test that threw before reaching its own `ws.close()` turned
 * `afterEach` into an UNBOUNDED wait, not a slow one. No test/hook budget
 * bounds that; a budget only decides how long the bill runs before vitest
 * reports "Hook timed out". Closing here, unconditionally, is what makes the
 * failure of any test in this file report promptly.
 */
const clients: WebSocket[] = []
const serverSockets: Duplex[] = []

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
  // Tracked first, so teardown owns the raw socket even for handshakes the
  // handler rejects and destroys itself.
  server.on('upgrade', (_req, socket) => {
    serverSockets.push(socket)
  })
  server.on('upgrade', upgrade)
  return new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port
      resolve()
    }),
  )
}

/** Hard-close every tracked socket, then wait for the server to actually close. */
async function stopServer(): Promise<void> {
  for (const ws of clients.splice(0)) ws.terminate()
  for (const socket of serverSockets.splice(0)) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

/**
 * Open a tracked client socket against the current server.
 *
 * The no-op `'error'` listener is required, not defensive. Teardown calls
 * `terminate()` on whatever is still open, and terminating a socket that is
 * still CONNECTING emits an `'error'` ("WebSocket was closed before the
 * connection was established"); with no listener attached, `ws` re-emits it as
 * an unhandled exception, which vitest flags as possibly causing false
 * positives. Four tests here attach no `'error'` handler of their own, and it
 * would fire on exactly the teardown path that exists to make failures report
 * cleanly. Tests that need to OBSERVE an error still add their own listener —
 * this one only guarantees the event is never unhandled.
 */
function connect(path: string, opts?: ClientOptions): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, opts)
  ws.on('error', () => {})
  clients.push(ws)
  return ws
}

/**
 * Resolve on `open`, but REJECT on the terminal handshake outcomes rather
 * than waiting for a budget to expire: an `open` that never arrives is a
 * failure this file should report in milliseconds.
 */
function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', (err) => reject(err))
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`handshake rejected with HTTP ${res.statusCode}`)),
    )
    ws.once('close', () => reject(new Error('socket closed before open')))
  })
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    ws.once('close', () => resolve())
  })
}

/**
 * Poll a condition against a WALL-CLOCK deadline.
 *
 * The server-side effects these tests observe (`acceptConnection` registering
 * the pairing, `markAwaitingClaude` writing the store) are async, and a fixed
 * `setTimeout(…, 10)` does not wait for them — it races them, and on a loaded
 * machine it loses (#147, #191). A deadline-driven poll turns that into "as
 * fast as the machine allows, up to a generous ceiling", so the test measures
 * the transition rather than the scheduler.
 */
async function waitUntil(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await cond()) return
    if (Date.now() >= deadline)
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const waitForPaired = (tid: string): Promise<void> =>
  waitUntil(`pairing ${tid} to register`, () => registry.isPaired(tid))

beforeEach(async () => {
  await startServer()
})

afterEach(async () => {
  await stopServer()
})

describe('createWsUpgradeHandler', () => {
  it('accepts a WS connection with a valid token and registers the pairing', async () => {
    const { token } = await seedToken(store, { tid: 't1', uid: 'u1', status: 'awaiting-ws' })
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`)
    await waitForOpen(ws)
    await waitForPaired('t1')
    expect(registry.isPaired('t1')).toBe(true)
    ws.close()
    await waitForClose(ws)
  })

  it('rejects a connection with a missing token (401 Unauthorized)', async () => {
    const ws = connect('/agent/ws')
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
    const ws = connect('/agent/ws?token=agt_unknown')
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
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`)
    await waitForOpen(ws)
    // Wait for the pairing to actually REGISTER first. Without this the
    // unregister assertion below passes vacuously — it would hold just as well
    // if the pairing had never been created at all (proved by mutation: point
    // it at a tid that never existed and the file still passes).
    await waitForPaired('t2')
    ws.close()
    await waitForClose(ws)
    await waitUntil('pairing t2 to be unregistered', () => !registry.isPaired('t2'))
    expect(registry.isPaired('t2')).toBe(false)
  })

  it('transitions token status to awaiting-claude on WS connect', async () => {
    const { token } = await seedToken(store, { tid: 't3', uid: 'u1', status: 'awaiting-ws' })
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`)
    await waitForOpen(ws)
    // `markAwaitingClaude` runs on the server side after the socket opens;
    // wait for the transition itself rather than for a fixed interval.
    await waitUntil(
      't3 to reach awaiting-claude',
      async () => (await store.findByTid('t3'))?.status === 'awaiting-claude',
    )
    const rec = await store.findByTid('t3')
    expect(rec?.status).toBe('awaiting-claude')
    ws.close()
    await waitForClose(ws)
  })

  it('rejects a cross-origin handshake (CSWSH, 403)', async () => {
    // A browser always sends Origin; a foreign Origin with no allowlist
    // configured must be rejected as same-origin-only.
    const { token } = await seedToken(store, { tid: 'tco', uid: 'u1', status: 'awaiting-ws' })
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`, {
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
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`, {
      headers: { origin: `http://127.0.0.1:${port}` },
    })
    await waitForOpen(ws)
    await waitForPaired('tso')
    expect(registry.isPaired('tso')).toBe(true)
    ws.close()
    await waitForClose(ws)
  })

  it('accepts an allowlisted cross-origin handshake when corsOrigins is set', async () => {
    await stopServer()
    await startServer(['http://trusted.example'])
    const { token } = await seedToken(store, { tid: 'tal', uid: 'u1', status: 'awaiting-ws' })
    const ws = connect(`/agent/ws?token=${encodeURIComponent(token)}`, {
      headers: { origin: 'http://trusted.example' },
    })
    await waitForOpen(ws)
    await waitForPaired('tal')
    expect(registry.isPaired('tal')).toBe(true)
    ws.close()
    await waitForClose(ws)
  })

  it('ignores non /agent/ws upgrade paths', async () => {
    // Send a GET with Upgrade to /other → handler should do nothing; connection hangs.
    // Simulate by trying to upgrade a different path and asserting the socket closes.
    // Simplified: the handler only runs on `server.on('upgrade')` dispatched events, so
    // an upgrade to /other would reach the handler too — but the handler's first check
    // is the path. Test by sending to `/other` and expecting 404/close.
    const ws = connect('/other?token=x')
    await new Promise<void>((resolve) => {
      ws.on('unexpected-response', (_req, res) => {
        expect(res.statusCode).toBe(404)
        resolve()
      })
      ws.on('error', () => resolve())
    })
  })
})
