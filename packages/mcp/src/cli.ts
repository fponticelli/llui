#!/usr/bin/env node
import { createServer } from 'node:http'
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import { randomUUID, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LluiMcpServer, mcpActiveFilePath, mcpHttpTokenPath } from './index.js'
import { tokensMatch, isLoopbackOrigin, isLoopbackAuthority } from './util/loopback.js'
import { watchParent, parentWatchDisabled } from './util/parent-watch.js'

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
 * Promisified `server.listen`, resolving with the port that was actually
 * bound. With `port: 0` that is an OS-assigned ephemeral port, which is
 * the only value any client can use.
 */
function listen(server: HttpServer, port: number, host: string): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening)
      rejectPort(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      resolvePort(address !== null && typeof address === 'object' ? address.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

/**
 * Write a diagnostic without ever becoming the reason the process dies badly.
 * The one caller that matters runs precisely when the parent is gone, i.e. when
 * the inherited stderr pipe has no reader and the write raises EPIPE.
 */
function noteToStderr(message: string): void {
  try {
    process.stderr.write(message)
  } catch {
    // Nobody is listening; the shutdown below is the point, not the message.
  }
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
    await server.startBridge()
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(
      `[llui-mcp] listening on stdio; bridge ws://127.0.0.1:${server.boundPort() ?? bridgePort}\n`,
    )

    const shutdown = (): void => {
      server.stopBridge()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    // Nothing propagates a parent's death to a non-detached child, so without
    // this a killed `pnpm dev` / vitest worker / MCP client leaves this process
    // alive at PPID 1 forever (#192). Signals are not enough: the parent may
    // die without sending one.
    watchParent({
      getPpid: () => process.ppid,
      disabled: parentWatchDisabled(),
      onParentGone: () => {
        noteToStderr('[llui-mcp] parent process exited; shutting down\n')
        shutdown()
      },
    })
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

  // Bind BEFORE building the bridge host: `--http 0` asks the OS for a
  // free port (the only way concurrent instances on one machine cannot
  // collide), and the port every consumer reads — the marker file, the
  // bridge diagnostic, the line logged below — is knowable only once the
  // socket is listening. Nothing can reach the server before this
  // resolves, so there is no window to miss a request.
  const boundPort = await listen(httpServer, httpPort, '127.0.0.1')

  // Single bridge host: owns the WS relay, tool registry, and marker
  // file. All MCP sessions route tool calls through its relay via
  // `createSessionMcp()` — ensures the browser-connected state is
  // shared instead of each session creating its own dead relay.
  const bridgeHost = new LluiMcpServer({
    bridgePort: boundPort,
    attachTo: httpServer,
    devUrl: parseUrlFlag(args) ?? undefined,
    headed: parseHeadedFlag(args),
    enableEval: parseEnableEvalFlag(args),
  })
  await bridgeHost.startBridge()

  process.stderr.write(
    `[llui-mcp] HTTP transport on http://127.0.0.1:${boundPort}/mcp; bridge ws://127.0.0.1:${boundPort}/bridge\n`,
  )

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
  // HTTP mode is the orphan-prone one: it binds a port, so a survivor is not
  // merely a stray process but a machine-global resource nobody can name. The
  // 31 h orphan in #192 was exactly this path, spawned by a test whose parent
  // was torn down without running its `finally`.
  watchParent({
    getPpid: () => process.ppid,
    disabled: parentWatchDisabled(),
    onParentGone: () => {
      noteToStderr('[llui-mcp] parent process exited; shutting down\n')
      shutdown().catch(() => process.exit(1))
    },
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
    //     Reject non-loopback Host and cross-origin Origin headers. The
    //     Host check routes through @llui/security's `isLoopbackAuthority`
    //     (the single shared implementation, unified with the vite-plugin
    //     request-guard) so the loopback host set can't drift — notably it
    //     recognizes an unbracketed IPv6 `::1` authority, which the old
    //     hand-rolled `host.split(':')[0]` mangled into a rejection. An
    //     absent Host is NOT provably same-machine, so it is rejected too.
    const hostHeader = singleHeader(req.headers.host)
    const originHeader = singleHeader(req.headers.origin)
    if (!isLoopbackAuthority(hostHeader) || !isLoopbackOrigin(originHeader)) {
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
