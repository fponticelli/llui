#!/usr/bin/env node
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LluiMcpServer, mcpActiveFilePath } from './index.js'

/**
 * Parse `--http [port]` from argv. Returns:
 *   - null   → stdio mode (default)
 *   - number → HTTP mode on that port
 */
function parseHttpFlag(argv: string[]): number | null {
  const idx = argv.indexOf('--http')
  if (idx < 0) return null
  const next = argv[idx + 1]
  if (next && !next.startsWith('-') && /^\d+$/.test(next)) {
    return Number(next)
  }
  return Number(process.env.LLUI_MCP_PORT ?? 5200)
}

const bridgePort = Number(process.env.LLUI_MCP_PORT ?? 5200)
const args = process.argv.slice(2)
const httpPort = parseHttpFlag(args)

if (args[0] === 'doctor') {
  doctor(bridgePort).then(
    (ok) => process.exit(ok ? 0 : 1),
    (err) => {
      process.stderr.write(`[llui-mcp doctor] fatal: ${String(err)}\n`)
      process.exit(2)
    },
  )
} else {
  main().catch((err) => {
    process.stderr.write(`[llui-mcp] fatal: ${String(err)}\n`)
    process.exit(1)
  })
}

async function main(): Promise<void> {
  if (httpPort === null) {
    // Stdio mode — Claude's `.mcp.json` spawns llui-mcp and talks over
    // stdin/stdout. The bridge runs on its own WebSocket server on
    // `bridgePort`.
    const server = new LluiMcpServer(bridgePort)
    server.startBridge()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(`[llui-mcp] listening on stdio; bridge ws://127.0.0.1:${bridgePort}\n`)

    const shutdown = (): void => {
      server.stopBridge()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }

  // HTTP mode — plugin-spawned. One `http.Server` serves both the MCP
  // Streamable HTTP transport (`/mcp`) and the browser bridge WebSocket
  // (upgrade on `/bridge`). `.mcp.json` uses type: "http" with url
  // `http://127.0.0.1:<port>/mcp`.
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>()
  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: String(err) }))
    })
  })

  // Single bridge attached to the HTTP server; all MCP sessions share it.
  const bridgeServer = new LluiMcpServer({ bridgePort: httpPort, attachTo: httpServer })
  bridgeServer.startBridge()

  httpServer.listen(httpPort, '127.0.0.1', () => {
    process.stderr.write(
      `[llui-mcp] HTTP transport on http://127.0.0.1:${httpPort}/mcp; bridge ws://127.0.0.1:${httpPort}/bridge\n`,
    )
  })

  const shutdown = async (): Promise<void> => {
    bridgeServer.stopBridge()
    for (const t of mcpTransports.values()) await t.close()
    mcpTransports.clear()
    httpServer.close()
    process.exit(0)
  }
  process.on('SIGINT', () => {
    shutdown().catch(() => process.exit(1))
  })
  process.on('SIGTERM', () => {
    shutdown().catch(() => process.exit(1))
  })

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/'
    if (!url.startsWith('/mcp')) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    // Session routing: the SDK's StreamableHTTPServerTransport is
    // stateful. The first request (initialize) creates a session id
    // returned in the `mcp-session-id` response header; subsequent
    // requests carry it as the `mcp-session-id` header.
    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : undefined
    let transport = sessionId ? mcpTransports.get(sessionId) : undefined

    if (!transport) {
      // New session. Each MCP session gets its own server instance
      // (SDK requirement), but all share the one browser bridge.
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          mcpTransports.set(id, transport!)
        },
      })
      transport.onclose = () => {
        const id = transport!.sessionId
        if (id) mcpTransports.delete(id)
      }
      const sessionServer = new LluiMcpServer({ bridgePort: httpPort!, attachTo: httpServer })
      await sessionServer.connect(transport)
    }

    await transport.handleRequest(req, res)
  }
}

async function doctor(port: number): Promise<boolean> {
  // Offline checks only — doctor doesn't require the server to be
  // running. Walks the same states the RelayUnavailableError diagnostic
  // surfaces at runtime, plus a port-liveness probe.
  const markerPath = mcpActiveFilePath()
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []

  checks.push({
    name: 'marker file',
    ok: existsSync(markerPath),
    detail: markerPath,
  })

  let markerPayload: { port?: number; pid?: number; devUrl?: string } | null = null
  if (existsSync(markerPath)) {
    try {
      markerPayload = JSON.parse(readFileSync(markerPath, 'utf8')) as {
        port?: number
        pid?: number
        devUrl?: string
      }
    } catch {
      markerPayload = null
    }
    checks.push({
      name: 'marker valid JSON',
      ok: markerPayload !== null,
      detail: markerPayload !== null ? 'OK' : 'malformed — delete and restart MCP',
    })
    checks.push({
      name: 'plugin devUrl stamped',
      ok: typeof markerPayload?.devUrl === 'string',
      detail:
        typeof markerPayload?.devUrl === 'string'
          ? markerPayload.devUrl
          : 'vite-plugin has not stamped its dev URL',
    })
  }

  const targetPort = markerPayload?.port ?? port
  const reachable = await probePort(targetPort)
  checks.push({
    name: `bridge port ${targetPort} listening`,
    ok: reachable,
    detail: reachable ? '127.0.0.1 connectable' : 'no process bound; MCP server not running',
  })

  if (typeof markerPayload?.pid === 'number') {
    const alive = isPidAlive(markerPayload.pid)
    checks.push({
      name: `marker pid ${markerPayload.pid}`,
      ok: alive,
      detail: alive ? 'process alive' : 'stale — delete the marker',
    })
  }

  let allOk = true
  process.stdout.write('llui-mcp doctor\n')
  process.stdout.write('—\n')
  for (const c of checks) {
    allOk = allOk && c.ok
    process.stdout.write(`${c.ok ? '✓' : '✗'} ${c.name.padEnd(32)} ${c.detail}\n`)
  }
  process.stdout.write('—\n')
  process.stdout.write(allOk ? 'All checks passed.\n' : 'Some checks failed — see above.\n')
  return allOk
}

async function probePort(port: number): Promise<boolean> {
  const { Socket } = await import('node:net')
  return new Promise<boolean>((resolve) => {
    const sock = new Socket()
    const done = (ok: boolean): void => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(500)
    sock.on('connect', () => done(true))
    sock.on('error', () => done(false))
    sock.on('timeout', () => done(false))
    sock.connect(port, '127.0.0.1')
  })
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
