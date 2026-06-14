import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { killChild } from './kill-child'
import { mcpHttpTokenPath } from '../src/index'

/**
 * Low-level POST that can set the forbidden `Host` header (the `fetch`
 * API silently drops it). Used to exercise the DNS-rebinding Host gate.
 */
function rawPost(
  port: number,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number }> {
  return new Promise((resolveP, rejectP) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      res.resume()
      res.on('end', () => resolveP({ status: res.statusCode ?? 0 }))
    })
    req.on('error', rejectP)
    req.end(body)
  })
}

// Integration test: spawn the built CLI in HTTP mode, issue an
// `initialize` JSON-RPC call over HTTP, verify the SDK-backed response
// comes back. Pins the contract so future refactors don't silently
// break the HTTP transport path plugin-spawn mode depends on.

const CLI_PATH = resolve(__dirname, '../dist/cli.js')
const TEST_PORT = 15210

// Module-scoped so the `callMcp` helper (defined below the describe) can
// attach the bearer token to every authenticated request by default.
let token = ''

describe('llui-mcp --http integration', () => {
  let proc: ChildProcess | null = null

  beforeAll(async () => {
    proc = spawn(process.execPath, [CLI_PATH, '--http', String(TEST_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Wait for the server to log its listening line; the logged string
    // confirms the bind succeeded before we send. The timeout is generous
    // (not "1s is plenty") because a cold `node` spawn + loading the MCP
    // SDK under a CPU-starved parallel CI run can take many seconds — a
    // 2s cap flaked the container CI. We resolve as soon as the line
    // appears, so the happy path stays fast.
    const ready = await waitForStderr(proc, /HTTP transport on/, 30000)
    if (!ready) throw new Error('[llui-mcp] did not start within 30s')
    // The per-launch bearer token is written to a 0600 file a same-user
    // local client can read. Mirrors how the Vite plugin / native client
    // would authenticate.
    token = readFileSync(mcpHttpTokenPath(), 'utf8').trim()
    expect(token.length).toBeGreaterThan(0)
  }, 35000)

  afterAll(async () => {
    await killChild(proc)
    proc = null
  })

  it('rejects a request with no bearer token (401)', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '1' },
        },
      }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a request with a wrong bearer token (401)', async () => {
    const res = await callMcp(
      TEST_PORT,
      {
        jsonrpc: '2.0',
        id: 98,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '1' },
        },
      },
      undefined,
      { token: 'deadbeef-not-the-real-token' },
    )
    expect(res.status).toBe(401)
  })

  it('rejects a cross-origin POST even with the right token (403)', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        origin: 'http://evil.example.com',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 97, method: 'initialize', params: {} }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a literal Origin: null even with the right token (403)', async () => {
    // A sandboxed iframe / file:/data: document sends `Origin: null`. That
    // is a browser context, not an absent header, so it must NOT be treated
    // as a trusted native client.
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        origin: 'null',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 95, method: 'initialize', params: {} }),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a non-local Host header even with the right token (403)', async () => {
    // Must use a raw request: `fetch` treats `Host` as a forbidden
    // header and silently drops it, so the gate can't be exercised
    // through it.
    const res = await rawPost(
      TEST_PORT,
      '/mcp',
      {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        host: 'attacker.example.com',
      },
      JSON.stringify({ jsonrpc: '2.0', id: 96, method: 'initialize', params: {} }),
    )
    expect(res.status).toBe(403)
  })

  it('routes tool calls through the shared bridge relay (not dead session relays)', async () => {
    // Regression: every HTTP session used to construct its own
    // LluiMcpServer (with its own unstarted relay), so browser-bound
    // tool calls failed with RelayUnavailableError even when a browser
    // was attached. Post-fix, sessions use `createSessionMcp()` which
    // shares the bridgeHost's registry + relay.
    //
    // The assertion here is INDIRECT — we don't mount a real browser —
    // but any bridge-unavailable response carries the current marker
    // state in its diagnostic. The port we report is the bridgeHost's
    // port, proving the call reached the shared relay. If sessions
    // had dead relays, the diagnostic would report `port: null`
    // (session relay constructed with `port: undefined`).
    const init = await callMcp(TEST_PORT, {
      jsonrpc: '2.0',
      id: 10,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1' },
      },
    })
    const sessionId = init.sessionId
    expect(sessionId).toBeTruthy()
    await callMcp(TEST_PORT, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)

    const call = await callMcp(
      TEST_PORT,
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'llui_get_state', arguments: {} },
      },
      sessionId,
    )
    expect(call.status).toBe(200)
    const msg = parseFirstMessage(call.body) as {
      result?: {
        isError?: boolean
        content?: Array<{ text: string }>
      }
    }
    // The tool will fail (no browser attached in this test) but the
    // error must come from the LIVE bridgeHost relay. The discriminator
    // is `bridge.running` — bridgeHost has startBridge()'d (running:
    // true); a dead session-local relay wouldn't have (running: false).
    expect(msg.result?.isError).toBe(true)
    const diagText = msg.result?.content?.[0]?.text ?? ''
    const diag = JSON.parse(diagText) as {
      bridge?: { running?: boolean; port?: number | null }
    }
    expect(diag.bridge?.running).toBe(true)
    expect(diag.bridge?.port).toBe(TEST_PORT)
  })

  it('handles initialize + tools/list over HTTP', async () => {
    const initRes = await callMcp(TEST_PORT, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1' },
      },
    })
    expect(initRes.status).toBe(200)
    const sessionId = initRes.sessionId
    expect(sessionId).toBeTruthy()
    const initMsg = parseFirstMessage(initRes.body)
    expect(initMsg.result?.serverInfo?.name).toBe('@llui/mcp')
    expect(initMsg.result?.capabilities?.tools).toBeDefined()

    // Send the initialized notification (required before tools/list
    // per the MCP spec). StreamableHTTP transport expects it.
    await callMcp(TEST_PORT, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)

    const toolsRes = await callMcp(
      TEST_PORT,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      sessionId,
    )
    expect(toolsRes.status).toBe(200)
    const toolsMsg = parseFirstMessage(toolsRes.body)
    expect(Array.isArray(toolsMsg.result?.tools)).toBe(true)
    expect((toolsMsg.result?.tools as unknown[]).length).toBeGreaterThan(0)
  })
})

// ── Helpers ───────────────────────────────────────────────────────

interface McpCallResult {
  status: number
  sessionId: string | undefined
  body: string
}

async function callMcp(
  port: number,
  payload: Record<string, unknown>,
  sessionId?: string,
  opts?: { token?: string },
): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  // Default to the live per-launch token; tests that want to exercise a
  // bad/missing token override it explicitly.
  const bearer = opts && 'token' in opts ? opts.token : token
  if (bearer) headers['authorization'] = `Bearer ${bearer}`
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') ?? sessionId,
    body: await res.text(),
  }
}

function parseFirstMessage(body: string): {
  result?: {
    serverInfo?: { name?: string }
    capabilities?: { tools?: unknown }
    tools?: unknown
  }
} {
  // SSE: `event: message\ndata: <json>\n\n`
  const dataLine = body.split('\n').find((line) => line.startsWith('data:'))
  if (!dataLine) throw new Error(`No SSE data in response: ${body.slice(0, 200)}`)
  return JSON.parse(dataLine.slice('data:'.length).trim()) as ReturnType<typeof parseFirstMessage>
}

async function waitForStderr(
  proc: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
): Promise<boolean> {
  let seen = ''
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    proc.stderr?.on('data', (buf: Buffer) => {
      seen += buf.toString()
      if (pattern.test(seen)) {
        clearTimeout(timer)
        resolvePromise(true)
      }
    })
    // Some environments buffer stderr briefly; small poll tick helps
    ;(async () => {
      while (!seen && timeoutMs > 0) await delay(50)
    })()
  })
}
