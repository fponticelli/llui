import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketRelayTransport } from '../src/transports/relay'

// ── helpers ─────────────────────────────────────────────────────

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })
}

/** Try to open a ws and resolve to 'open' or 'rejected'. */
function tryConnect(
  url: string,
  opts?: WebSocket.ClientOptions,
  protocols?: string | string[],
): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, protocols ?? [], opts)
    ws.on('open', () => resolve('open'))
    ws.on('error', () => resolve('rejected'))
    ws.on('unexpected-response', () => resolve('rejected'))
    cleanups.push(() => {
      try {
        ws.close()
      } catch {
        /* noop */
      }
    })
  })
}

// ── standalone (own port) mode ──────────────────────────────────

describe('bridge upgrade validation — standalone mode', () => {
  it('accepts a loopback / no-Origin client', async () => {
    const port = 5411
    const r = new WebSocketRelayTransport({ port })
    cleanups.push(() => r.stop())
    r.start()
    expect(await tryConnect(`ws://127.0.0.1:${port}`)).toBe('open')
  })

  it('rejects a cross-origin (CSWSH) upgrade', async () => {
    const port = 5412
    const r = new WebSocketRelayTransport({ port })
    cleanups.push(() => r.stop())
    r.start()
    expect(await tryConnect(`ws://127.0.0.1:${port}`, { origin: 'http://evil.example.com' })).toBe(
      'rejected',
    )
  })

  it('accepts an explicit loopback Origin', async () => {
    const port = 5413
    const r = new WebSocketRelayTransport({ port })
    cleanups.push(() => r.stop())
    r.start()
    expect(await tryConnect(`ws://127.0.0.1:${port}`, { origin: 'http://localhost:5173' })).toBe(
      'open',
    )
  })

  it('rejects a second concurrent client instead of superseding the first', async () => {
    const port = 5414
    const r = new WebSocketRelayTransport({ port })
    cleanups.push(() => r.stop())
    r.start()
    expect(await tryConnect(`ws://127.0.0.1:${port}`)).toBe('open')
    // First is still live → second must be refused.
    expect(await tryConnect(`ws://127.0.0.1:${port}`)).toBe('rejected')
  })
})

// ── attached (shared HTTP port) mode — token enforced ───────────

describe('bridge upgrade validation — attachTo mode enforces the token', () => {
  function setup(token: string | null): Promise<{ port: number }> {
    const dir = mkdtempSync(join(tmpdir(), 'llui-relay-auth-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const tokenPath = join(dir, 'http-token')
    if (token !== null) writeFileSync(tokenPath, token, { mode: 0o600 })
    const server = createServer((_req, res) => {
      res.statusCode = 200
      res.end('ok')
    })
    cleanups.push(() => server.close())
    const relay = new WebSocketRelayTransport({ attachTo: server, authTokenPath: tokenPath })
    cleanups.push(() => relay.stop())
    relay.start()
    return listen(server).then((port) => ({ port }))
  }

  it('accepts /bridge with the correct token via query param', async () => {
    const { port } = await setup('sekret')
    expect(await tryConnect(`ws://127.0.0.1:${port}/bridge?token=sekret`)).toBe('open')
  })

  it('accepts /bridge with the correct token via Sec-WebSocket-Protocol', async () => {
    const { port } = await setup('sekret')
    expect(
      await tryConnect(`ws://127.0.0.1:${port}/bridge`, undefined, ['llui-bridge', 'sekret']),
    ).toBe('open')
  })

  it('rejects /bridge with no token', async () => {
    const { port } = await setup('sekret')
    expect(await tryConnect(`ws://127.0.0.1:${port}/bridge`)).toBe('rejected')
  })

  it('rejects /bridge with the wrong token', async () => {
    const { port } = await setup('sekret')
    expect(await tryConnect(`ws://127.0.0.1:${port}/bridge?token=nope`)).toBe('rejected')
  })

  it('rejects a cross-origin /bridge upgrade even with a valid token', async () => {
    const { port } = await setup('sekret')
    expect(
      await tryConnect(`ws://127.0.0.1:${port}/bridge?token=sekret`, {
        origin: 'http://evil.example.com',
      }),
    ).toBe('rejected')
  })

  it('rejects an upgrade to a path other than /bridge', async () => {
    const { port } = await setup('sekret')
    expect(await tryConnect(`ws://127.0.0.1:${port}/other?token=sekret`)).toBe('rejected')
  })
})
