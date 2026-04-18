import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Integration test: spawn the built CLI in HTTP mode, issue an
// `initialize` JSON-RPC call over HTTP, verify the SDK-backed response
// comes back. Pins the contract so future refactors don't silently
// break the HTTP transport path plugin-spawn mode depends on.

const CLI_PATH = resolve(__dirname, '../dist/cli.js')
const TEST_PORT = 15210

describe('llui-mcp --http integration', () => {
  let proc: ChildProcess | null = null

  beforeAll(async () => {
    proc = spawn(process.execPath, [CLI_PATH, '--http', String(TEST_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Wait for the server to log its listening line. 1s is plenty; the
    // logged string lets us confirm the bind succeeded before we send.
    const ready = await waitForStderr(proc, /HTTP transport on/, 2000)
    if (!ready) throw new Error('[llui-mcp] did not start within 2s')
  }, 4000)

  afterAll(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM')
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
): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
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
