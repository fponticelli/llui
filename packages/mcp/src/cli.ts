#!/usr/bin/env node
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LluiMcpServer, mcpActiveFilePath, mcpHttpTokenPath } from './index.js'
import { tokensMatch, isLoopbackOrigin } from './util/loopback.js'

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

/**
 * Parse `--url <url>` from argv. Returns the URL if present, null otherwise.
 */
function parseUrlFlag(argv: string[]): string | null {
  const idx = argv.indexOf('--url')
  if (idx < 0) return null
  const next = argv[idx + 1]
  return next && !next.startsWith('-') ? next : null
}

/**
 * Parse `--headed` from argv. Returns true if the flag is present.
 */
function parseHeadedFlag(argv: string[]): boolean {
  return argv.includes('--headed')
}

/**
 * Parse `--enable-eval` from argv. Returns true if the flag is present.
 *
 * SECURITY: opts in to the arbitrary-JS `llui_eval` tool (RCE against the
 * user's browser session). Also honored via `LLUI_MCP_ENABLE_EVAL=1`.
 */
function parseEnableEvalFlag(argv: string[]): boolean {
  return argv.includes('--enable-eval') || process.env['LLUI_MCP_ENABLE_EVAL'] === '1'
}

/**
 * Reject DNS-rebinding / cross-origin POSTs. Defends a local-only server
 * against a malicious web page in the user's browser POSTing to
 * `http://127.0.0.1:<port>/mcp`. We require:
 *   - the Host header (if present) to be a loopback host, and
 *   - the Origin header (if present) to be loopback OR absent.
 * A native MCP client sends no Origin and a loopback Host, so it passes.
 */
function isLocalHostHeader(host: string | undefined): boolean {
  if (host === undefined) return true
  // Strip an optional `:port` suffix. IPv6 hosts are bracketed
  // (`[::1]:5200`) so the last colon is the port separator only when the
  // host is not bracketed; handle both.
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

/** Collapse a possibly-multi-valued request header to a single string. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
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
    const server = new LluiMcpServer({
      bridgePort,
      devUrl: parseUrlFlag(args) ?? undefined,
      headed: parseHeadedFlag(args),
      enableEval: parseEnableEvalFlag(args),
    })
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
  // Per-launch random bearer token. Every `/mcp` request must present it
  // via `Authorization: Bearer <token>`. Written to a 0600 file a
  // same-user local client can read; never printed to stdout (which, in
  // http mode, is not the protocol channel but we keep the invariant).
  const httpToken = randomBytes(32).toString('hex')
  const tokenPath = mcpHttpTokenPath()
  try {
    mkdirSync(dirname(tokenPath), { recursive: true })
    writeFileSync(tokenPath, httpToken, { mode: 0o600 })
  } catch (err) {
    process.stderr.write(`[llui-mcp] failed to write http token file: ${String(err)}\n`)
  }

  const mcpTransports = new Map<string, StreamableHTTPServerTransport>()
  const httpServer = createServer((req, res) => {
    handleHttp(req, res).catch((err) => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: String(err) }))
    })
  })

  // Single bridge host: owns the WS relay, tool registry, and marker
  // file. All MCP sessions route tool calls through its relay via
  // `createSessionMcp()` — ensures the browser-connected state is
  // shared instead of each session creating its own dead relay.
  const bridgeHost = new LluiMcpServer({
    bridgePort: httpPort,
    attachTo: httpServer,
    devUrl: parseUrlFlag(args) ?? undefined,
    headed: parseHeadedFlag(args),
    enableEval: parseEnableEvalFlag(args),
  })
  bridgeHost.startBridge()

  httpServer.listen(httpPort, '127.0.0.1', () => {
    process.stderr.write(
      `[llui-mcp] HTTP transport on http://127.0.0.1:${httpPort}/mcp; bridge ws://127.0.0.1:${httpPort}/bridge\n`,
    )
  })

  const shutdown = async (): Promise<void> => {
    bridgeHost.stopBridge()
    for (const t of mcpTransports.values()) await t.close()
    mcpTransports.clear()
    try {
      if (existsSync(tokenPath)) unlinkSync(tokenPath)
    } catch {
      // Best-effort cleanup — the token is per-launch and worthless once
      // the process is gone.
    }
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

    // ── Security gate (BEFORE any MCP handling) ──────────────────────
    // (a) DNS-rebinding / cross-origin defense: a malicious web page in
    //     the user's browser could POST to http://127.0.0.1:<port>/mcp.
    //     Reject non-loopback Host and cross-origin Origin headers.
    const hostHeader = singleHeader(req.headers.host)
    const originHeader = singleHeader(req.headers.origin)
    if (!isLocalHostHeader(hostHeader) || !isLoopbackOrigin(originHeader)) {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'forbidden: cross-origin or non-local host rejected' }))
      return
    }

    // (b) Bearer-token auth: every request must carry the per-launch
    //     secret. Without it the request is rejected before the MCP SDK
    //     ever sees it, so unauthenticated `initialize` / `tools/call`
    //     (incl. the exec tools and any gated eval) is impossible.
    const auth = singleHeader(req.headers.authorization) ?? ''
    const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (!presented || !tokensMatch(presented, httpToken)) {
      res.statusCode = 401
      res.setHeader('content-type', 'application/json')
      res.setHeader('www-authenticate', 'Bearer')
      res.end(JSON.stringify({ error: 'unauthorized: missing or invalid bearer token' }))
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
      // New session. SDK requires one `McpServer` per transport, but
      // all sessions must share the single browser bridge — route
      // through `createSessionMcp()` so the session's tool dispatch
      // lands on bridgeHost's registry + relay.
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
      const sessionMcp = bridgeHost.createSessionMcp()
      await sessionMcp.connect(transport)
    }

    await transport.handleRequest(req, res)
  }
}

async function doctor(port: number): Promise<boolean> {
  // Offline checks only — doctor doesn't require the server to be
  // running. Walks the same states the RelayUnavailableError diagnostic
  // surfaces at runtime, plus a port-liveness probe.
  //
  // Glyphs: emoji ✓/✗ by default, fall back to `OK`/`FAIL` when the
  // environment requests plain output. Honors `--plain` and the
  // standard `NO_COLOR` env var (https://no-color.org).
  const plain = args.includes('--plain') || process.env.NO_COLOR !== undefined
  const ok = plain ? 'OK  ' : '✓'
  const fail = plain ? 'FAIL' : '✗'
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
    process.stdout.write(`${c.ok ? ok : fail} ${c.name.padEnd(32)} ${c.detail}\n`)
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
