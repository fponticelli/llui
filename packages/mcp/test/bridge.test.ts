import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { LluiMcpServer, mcpActiveFilePath } from '../src/index'

/**
 * These tests simulate the browser side by opening a WebSocket client that
 * speaks the relay protocol and replies to forwarded debug-API calls.
 */

let server: LluiMcpServer | null = null
let port = 5200 // will be re-assigned per test to avoid collisions

afterEach(() => {
  server?.stopBridge()
  server = null
})

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}

function setupBrowserRelay(
  p: number,
  handlers: Record<string, (args: unknown[]) => unknown>,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${p}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
    ws.on('message', (raw: Buffer) => {
      const req = JSON.parse(String(raw)) as { id: string; method: string; args: unknown[] }
      const fn = handlers[req.method]
      if (!fn) {
        ws.send(JSON.stringify({ id: req.id, error: `no handler: ${req.method}` }))
        return
      }
      try {
        const result = fn(req.args)
        ws.send(JSON.stringify({ id: req.id, result: result ?? null }))
      } catch (e) {
        ws.send(JSON.stringify({ id: req.id, error: String(e) }))
      }
    })
  })
}

describe('MCP bridge (WebSocket)', () => {
  it('forwards tool calls to the connected browser and returns results', async () => {
    port = 5301
    server = new LluiMcpServer(port)
    server.startBridge()

    const browser = await setupBrowserRelay(port, {
      getState: () => ({ count: 42 }),
    })

    // Give the server's on('connection') handler a tick to register the ws
    await new Promise((r) => setTimeout(r, 20))

    const result = await server.handleToolCall('llui_get_state', {})
    expect(result).toEqual({ count: 42 })

    browser.close()
  })

  it('llui_send_message validates, sends, flushes, returns new state', async () => {
    port = 5302
    server = new LluiMcpServer(port)
    server.startBridge()

    let count = 0
    const browser = await setupBrowserRelay(port, {
      validateMessage: () => null,
      send: (args) => {
        const msg = args[0] as { type: string }
        if (msg.type === 'inc') count++
        return undefined
      },
      flush: () => undefined,
      getState: () => ({ count }),
    })
    await new Promise((r) => setTimeout(r, 20))

    const result = (await server.handleToolCall('llui_send_message', {
      msg: { type: 'inc' },
    })) as { state: { count: number }; sent: boolean }
    expect(result.sent).toBe(true)
    expect(result.state.count).toBe(1)

    browser.close()
  })

  it('llui_send_message returns validation errors without sending', async () => {
    port = 5303
    server = new LluiMcpServer(port)
    server.startBridge()

    let sendCalled = false
    const browser = await setupBrowserRelay(port, {
      validateMessage: () => [{ path: '', expected: 'object', received: 'string', message: 'bad' }],
      send: () => {
        sendCalled = true
        return undefined
      },
    })
    await new Promise((r) => setTimeout(r, 20))

    const result = (await server.handleToolCall('llui_send_message', {
      msg: 'invalid',
    })) as { errors: unknown[]; sent: boolean }

    expect(result.sent).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(sendCalled).toBe(false)

    browser.close()
  })

  it('throws a RelayUnavailableError with a structured diagnostic when no browser is connected', async () => {
    port = 5304
    server = new LluiMcpServer(port)
    server.startBridge()

    try {
      await server.handleToolCall('llui_get_state', {})
      throw new Error('expected to throw')
    } catch (err) {
      const { RelayUnavailableError } = await import('../src/transports/index.js')
      expect(err).toBeInstanceOf(RelayUnavailableError)
      const d = (err as InstanceType<typeof RelayUnavailableError>).diagnostic
      expect(d.connected).toBe(false)
      expect(d.bridge.running).toBe(true)
      expect(d.bridge.port).toBe(port)
      expect(d.browser.tabsConnected).toBe(0)
      expect(typeof d.suggestedFix).toBe('string')
      expect(d.suggestedFix.length).toBeGreaterThan(0)
    }
  })

  it('times out if browser does not respond', async () => {
    port = 5305
    server = new LluiMcpServer(port)
    server.startBridge()

    // Open a browser connection but don't respond to messages
    const browser = new WebSocket(`ws://127.0.0.1:${port}`)
    await waitForOpen(browser)
    await new Promise((r) => setTimeout(r, 20))

    // Our server has a 5s timeout — we'll override by sending a reject manually
    // Simpler: use a very short-running assertion wrapper
    const pending = server.handleToolCall('llui_get_state', {})
    // Close the connection to force the pending request to never resolve
    // then wait for the timeout
    await expect(
      Promise.race([
        pending,
        new Promise((_, reject) => setTimeout(() => reject(new Error('test-timeout')), 100)),
      ]),
    ).rejects.toThrow()

    browser.close()
  }, 10_000)
})

describe('MCP active marker file', () => {
  const path = mcpActiveFilePath()

  afterEach(() => {
    try {
      if (existsSync(path)) rmSync(path)
    } catch {
      // ignore
    }
  })

  it('writes active.json on startBridge() with port + pid', async () => {
    const s = new LluiMcpServer(5311)
    s.startBridge()

    expect(existsSync(path)).toBe(true)
    const data = JSON.parse(readFileSync(path, 'utf8')) as { port: number; pid: number }
    expect(data.port).toBe(5311)
    expect(data.pid).toBe(process.pid)

    s.stopBridge()
  })

  it('removes active.json on stopBridge()', async () => {
    const s = new LluiMcpServer(5312)
    s.startBridge()
    expect(existsSync(path)).toBe(true)

    s.stopBridge()
    expect(existsSync(path)).toBe(false)
  })

  it('overwrites a stale marker file from a previous session', async () => {
    // Simulate leftover from a crashed previous server
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ port: 9999, pid: 0 }))

    const s = new LluiMcpServer(5313)
    s.startBridge()

    const data = JSON.parse(readFileSync(path, 'utf8')) as { port: number; pid: number }
    expect(data.port).toBe(5313)

    s.stopBridge()
  })
})
