import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { LluiMcpServer, mcpActiveFilePath, mcpHttpTokenPath } from '../src/index'
import { WebSocketRelayTransport } from '../src/transports/relay'

/**
 * Issue #85 — no test may bind a fixed, machine-global TCP port, and no
 * two runs may contend for the same handshake marker.
 *
 * Two halves:
 *
 *  1. The RUNTIME contract that makes isolation possible: `bridgePort: 0`
 *     binds an ephemeral port, `startBridge()` resolves once that bind is
 *     live, and the port a client must actually reach is reported back —
 *     through `boundPort()`, the marker file, and the bridge diagnostic.
 *     Without this, a caller asking for port 0 advertises port 0 and the
 *     whole browser-discovery handshake points at nothing.
 *  2. A drift gate over this directory's own sources, because the fixed
 *     ports have been reintroduced (and the flake re-diagnosed from
 *     scratch) more than once.
 */

const relays: WebSocketRelayTransport[] = []
const servers: LluiMcpServer[] = []

afterEach(() => {
  for (const r of relays.splice(0)) r.stop()
  for (const s of servers.splice(0)) s.stopBridge()
})

function track(server: LluiMcpServer): LluiMcpServer {
  servers.push(server)
  return server
}

/** Resolve to 'open' | 'rejected' for a bridge WS connection attempt. */
function tryConnect(url: string): Promise<'open' | 'rejected'> {
  return new Promise((resolvePromise) => {
    const ws = new WebSocket(url)
    ws.on('open', () => {
      ws.close()
      resolvePromise('open')
    })
    ws.on('error', () => resolvePromise('rejected'))
  })
}

describe('ephemeral bridge bind (#85)', () => {
  it('binds a real port for bridgePort: 0 and reports it via boundPort()', async () => {
    const server = track(new LluiMcpServer({ bridgePort: 0 }))
    await server.startBridge()

    const port = server.boundPort()
    expect(port).not.toBeNull()
    expect(port).toBeGreaterThan(0)
    expect(await tryConnect(`ws://127.0.0.1:${port}`)).toBe('open')
  })

  it('writes the REACHABLE port into the marker file, not the requested 0', async () => {
    const server = track(new LluiMcpServer({ bridgePort: 0 }))
    await server.startBridge()

    const marker = JSON.parse(readFileSync(mcpActiveFilePath(), 'utf8')) as {
      port: number
      pid: number
    }
    expect(marker.port).toBe(server.boundPort())
    expect(marker.pid).toBe(process.pid)
  })

  it('reports the bound port in the bridge diagnostic', async () => {
    const server = track(new LluiMcpServer({ bridgePort: 0 }))
    await server.startBridge()

    const { RelayUnavailableError } = await import('../src/transports/index.js')
    await expect(server.handleToolCall('llui_get_state', {})).rejects.toThrow(RelayUnavailableError)
    try {
      await server.handleToolCall('llui_get_state', {})
    } catch (err) {
      const d = (err as InstanceType<typeof RelayUnavailableError>).diagnostic
      expect(d.bridge.running).toBe(true)
      expect(d.bridge.port).toBe(server.boundPort())
    }
  })

  it('gives two concurrently-started bridges distinct ports', async () => {
    const a = track(new LluiMcpServer({ bridgePort: 0 }))
    const b = track(new LluiMcpServer({ bridgePort: 0 }))
    await Promise.all([a.startBridge(), b.startBridge()])

    expect(a.boundPort()).toBeGreaterThan(0)
    expect(b.boundPort()).toBeGreaterThan(0)
    expect(a.boundPort()).not.toBe(b.boundPort())
  })

  it('resolves start() only once the standalone relay is actually listening', async () => {
    const relay = new WebSocketRelayTransport({ port: 0 })
    relays.push(relay)
    await relay.start()

    const port = relay.boundPort()
    expect(port).toBeGreaterThan(0)
    // `start()` resolving is the contract that the socket is reachable —
    // no polling, no arbitrary settle delay.
    expect(await tryConnect(`ws://127.0.0.1:${port}`)).toBe('open')
  })
})

describe('per-run handshake state directory (#85)', () => {
  it('roots the marker + token in LLUI_MCP_STATE_DIR when it is set', () => {
    const stateDir = process.env['LLUI_MCP_STATE_DIR']
    // The suite's setup file gives every worker its own directory; without
    // it two concurrent runs stomp each other's marker.
    expect(stateDir).toBeTruthy()
    expect(dirname(mcpActiveFilePath())).toBe(resolve(String(stateDir)))
    expect(dirname(mcpHttpTokenPath())).toBe(resolve(String(stateDir)))
  })
})

describe('no fixed ports in this suite (#85)', () => {
  // Bind-shaped port literals only — a `port`-suffixed key or binding
  // given a number, and the CLI's http-mode flag given one. Port numbers
  // inside URL strings are fixtures, not binds, and are deliberately not
  // matched. Only `0` (ask the OS for a free one) is allowed; a line that
  // really is not a bind can say so with an `llui-no-bind` comment.
  const BIND_LITERAL = /port\s*[:=]\s*(\d+)/i
  const HTTP_FLAG = /--http['",\s]+['"]?(\d+)/
  const ESCAPE = 'llui-no-bind'

  it('binds no fixed TCP port anywhere under test/', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const offenders: string[] = []
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.mjs')) continue
      if (entry === 'port-isolation.test.ts') continue // this file states the patterns
      const source = readFileSync(join(dir, entry), 'utf8')
      source.split('\n').forEach((line, i) => {
        if (line.includes(ESCAPE)) return
        for (const re of [BIND_LITERAL, HTTP_FLAG]) {
          const m = re.exec(line)
          if (m && m[1] !== '0') offenders.push(`${entry}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
