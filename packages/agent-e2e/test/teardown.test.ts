import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'

import { closeServer, runTeardownSteps, trackUpgradedSockets } from '../src/teardown.js'

/**
 * Cover for the harness teardown (#196).
 *
 * The thing under test is not "does close() close" — it is the two claims the
 * old three-line teardown got wrong:
 *
 *   1. `closeAllConnections()` reaps an SSE/streaming response but CANNOT reach
 *      an UPGRADED socket. The first test pair measures both directions rather
 *      than restating the belief, because a comment asserting it was what
 *      survived a whole lane spent disproving it.
 *   2. The harness was safe only because `await browser.close()` happened to run
 *      first. The last test kills that dependency: `browser.close()` throws and
 *      the server must still close.
 *
 * No browser is launched here. Playwright's `Browser` is stubbed to a single
 * `close()` that rejects — that is the only part of it the teardown touches, and
 * the 30 s shutdown floor this failure mode is about (#180) is precisely what
 * makes launching one to observe it a bad trade.
 */

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

async function listening(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

/** Resolves to 'closed' if `server.close()` calls back within `ms`, else 'hung'. */
function closeRace(server: Server, ms: number): Promise<'closed' | 'hung'> {
  return Promise.race([
    new Promise<'closed'>((resolve) => server.close(() => resolve('closed'))),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms).unref()),
  ])
}

describe('closeAllConnections reach', () => {
  it('DOES reach a streaming HTTP response that never ended', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': open\n\n') // deliberately never `end()`ed — this is the SSE shape
    })
    const port = await listening(server)

    const stream = await fetch(`http://127.0.0.1:${port}/sse`)
    expect(stream.body).not.toBeNull()

    server.closeAllConnections()
    expect(await closeRace(server, 1_000)).toBe('closed')
    await stream.body?.cancel().catch(() => undefined)
  })

  it('does NOT reach an upgraded WebSocket — the tracker is what does', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    const tracker = trackUpgradedSockets(server)
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })
    const port = await listening(server)

    const client = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })
    expect(tracker.size).toBe(1)

    // The disproven belief, measured: closeAllConnections() runs, and close()
    // still never calls back because the upgraded socket is counted-but-untracked.
    server.closeAllConnections()
    expect(await closeRace(server, 500)).toBe('hung')

    // What actually works.
    tracker.destroyAll()
    expect(await closeRace(server, 2_000)).toBe('closed')
    client.terminate()
  })

  it('closeServer terminates with a live upgraded socket, in one call', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    const tracker = trackUpgradedSockets(server)
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })
    const port = await listening(server)
    const client = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })

    await expect(closeServer(server, tracker)).resolves.toBeUndefined()
    client.terminate()
  })

  it('tracks a socket even when the upgrade handler rejects the handshake', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    const tracker = trackUpgradedSockets(server)
    // Registered AFTER the tracker: a rejecting handler destroys the socket, and
    // registering the tracker first is what keeps teardown owning it anyway.
    server.on('upgrade', (_req, socket) => {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
    })
    const port = await listening(server)

    const client = new WebSocket(`ws://127.0.0.1:${port}/nope`)
    await new Promise<void>((resolve) => {
      client.once('error', () => resolve())
      client.once('close', () => resolve())
    })
    await expect(closeServer(server, tracker)).resolves.toBeUndefined()
  })

  it('forgets sockets that close on their own', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    const tracker = trackUpgradedSockets(server)
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })
    const port = await listening(server)
    const client = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })
    expect(tracker.size).toBe(1)
    client.close()
    await waitForCondition(() => tracker.size === 0)
    expect(tracker.size).toBe(0)
  })
})

describe('runTeardownSteps', () => {
  it('runs every step and rethrows the single failure', async () => {
    const ran: string[] = []
    await expect(
      runTeardownSteps([
        [
          'a',
          () => {
            ran.push('a')
            throw new Error('a failed')
          },
        ],
        ['b', () => void ran.push('b')],
        ['c', () => void ran.push('c')],
      ]),
    ).rejects.toThrow('a failed')
    expect(ran).toEqual(['a', 'b', 'c'])
  })

  it('aggregates when more than one step fails', async () => {
    await expect(
      runTeardownSteps([
        [
          'a',
          () => {
            throw new Error('a failed')
          },
        ],
        [
          'b',
          async () => {
            throw new Error('b failed')
          },
        ],
      ]),
    ).rejects.toThrow(/teardown failed in 2 steps: a, b/)
  })

  /**
   * THE #196 REGRESSION TEST. The old teardown had no `try/finally`, so a
   * throwing `browser.close()` skipped `server.close()` — leaving a listening
   * server and a live upgraded socket behind, with a comment asserting that
   * could not happen.
   */
  it('closes the server even when browser.close() throws, with a WS still open', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    const tracker = trackUpgradedSockets(server)
    const wss = new WebSocketServer({ noServer: true })
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    })
    const port = await listening(server)
    const client = new WebSocket(`ws://127.0.0.1:${port}/agent/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve())
      client.once('error', reject)
    })
    expect(tracker.size).toBe(1)

    // Stands in for playwright burning its non-configurable 30 s deadline (#180).
    const browser = {
      close: () => Promise.reject(new Error('browser.close timed out after 30000ms')),
    }
    let mcpClosed = false

    const close = () =>
      runTeardownSteps([
        ['browser.close', () => browser.close()],
        ['mcpClient.close', () => void (mcpClosed = true)],
        ['server.close', () => closeServer(server, tracker)],
      ])

    await expect(close()).rejects.toThrow('browser.close timed out after 30000ms')
    // Everything after the throwing step still ran…
    expect(mcpClosed).toBe(true)
    // …and the server is genuinely closed, not merely "asked to close".
    expect(server.listening).toBe(false)
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    client.terminate()
  })
})

/** Tiny poll helper — `vi.waitFor` needs fake-timer awareness we don't want here. */
async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
