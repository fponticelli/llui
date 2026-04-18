#!/usr/bin/env node
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LluiMcpServer } from './index.js'

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
const httpPort = parseHttpFlag(process.argv.slice(2))

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

main().catch((err) => {
  process.stderr.write(`[llui-mcp] fatal: ${String(err)}\n`)
  process.exit(1)
})
