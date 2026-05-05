import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  FORWARDED_TOOL_DESCRIPTORS,
  DISCONNECT_SESSION_DESCRIPTOR,
  type McpForwardedToolDescriptor,
} from '../../mcp/tools.js'
import type { McpSessionMap } from './session-map.js'
import type { TokenStore } from '../token-store.js'
import { verifyAndReadTid } from '../lap/describe.js'

export type McpServerDeps = {
  /** WHATWG router from the agent core — used to call LAP endpoints internally. */
  coreRouter: (req: Request) => Promise<Response | null>
  tokenStore: TokenStore
  sessionMap: McpSessionMap
  /**
   * Returns the MCP session ID for this server instance. Called lazily so
   * the transport can assign the ID during `initialize` before any tool
   * handler fires.
   */
  getSessionId: () => string | undefined
  lapBasePath: string
  serverName: string
  serverVersion: string
  connectDescription: string
}

/**
 * Build one `McpServer` instance for a single MCP session. Tool handlers
 * call LAP endpoints via synthetic WHATWG Requests routed through
 * `coreRouter` — no extra HTTP round-trip to localhost needed.
 */
export function createAgentMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: deps.serverName, version: deps.serverVersion },
    { capabilities: { tools: {} } },
  )

  // ── connect_session ────────────────────────────────────────────────
  server.registerTool(
    'connect_session',
    {
      description: deps.connectDescription,
      inputSchema: z.object({
        token: z.string().describe('Bearer token from the app connect panel'),
      }).shape,
    },
    async ({ token }) => {
      // Verify the token and extract the tid. We re-use the existing
      // LAP auth helper by constructing a minimal synthetic Request.
      const authReq = new Request('http://local/auth', {
        headers: { authorization: `Bearer ${token}` },
      })
      const auth = await verifyAndReadTid(authReq, deps.tokenStore)
      if (!auth.ok) {
        return errorResult(
          auth.code === 'auth-failed'
            ? 'Token is invalid or expired. Ask the user to copy a fresh token from the app.'
            : `Auth failed: ${auth.code}`,
        )
      }

      const sessionId = deps.getSessionId()
      if (!sessionId) return errorResult('MCP session not yet initialized — retry in a moment.')

      deps.sessionMap.set(sessionId, { tid: auth.tid, token })

      // Prefetch the initial observe bundle — same reason the bridge does
      // this: Claude gets state + actions + description + context in one
      // call, avoiding a follow-up round-trip.
      const result = await lapCall(deps.coreRouter, token, deps.lapBasePath, '/observe', {})
      if (!result.ok) {
        deps.sessionMap.delete(sessionId)
        return errorResult(`connect_session: observe failed — ${result.error}`)
      }
      return okResult({ status: 'connected', ...result.body as object })
    },
  )

  // ── disconnect_session ─────────────────────────────────────────────
  server.registerTool(
    DISCONNECT_SESSION_DESCRIPTOR.name,
    {
      description: DISCONNECT_SESSION_DESCRIPTOR.description,
      inputSchema: DISCONNECT_SESSION_DESCRIPTOR.schema.shape,
    },
    async () => {
      const sessionId = deps.getSessionId()
      if (sessionId) deps.sessionMap.delete(sessionId)
      return okResult({ status: 'disconnected' })
    },
  )

  // ── forwarded tools ────────────────────────────────────────────────
  for (const desc of FORWARDED_TOOL_DESCRIPTORS) {
    registerForwardedTool(server, deps, desc)
  }

  return server
}

function registerForwardedTool(
  server: McpServer,
  deps: McpServerDeps,
  desc: McpForwardedToolDescriptor,
): void {
  server.registerTool(
    desc.name,
    { description: desc.description, inputSchema: desc.schema.shape },
    async (args) => {
      const sessionId = deps.getSessionId()
      const session = sessionId ? deps.sessionMap.get(sessionId) : null
      if (!session) {
        return errorResult(
          'Not connected — ask the user to copy the token from the app connect panel ' +
            'and call connect_session with it.',
        )
      }
      const result = await lapCall(
        deps.coreRouter,
        session.token,
        deps.lapBasePath,
        desc.lapPath,
        (args ?? {}) as Record<string, unknown>,
      )
      if (!result.ok) return errorResult(`${desc.name}: ${result.error}`)
      return okResult(result.body)
    },
  )
}

/**
 * Call a LAP endpoint internally by constructing a synthetic WHATWG
 * Request and routing it through the agent core's router. No actual
 * HTTP round-trip — the router handles it in-process.
 */
async function lapCall(
  coreRouter: (req: Request) => Promise<Response | null>,
  token: string,
  lapBasePath: string,
  lapPath: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const req = new Request(`http://local${lapBasePath}${lapPath}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  try {
    const res = await coreRouter(req)
    if (!res) return { ok: false, error: `no handler for ${lapPath}` }
    const payload = await res.json() as { error?: { code: string; detail?: string } }
    if (!res.ok || payload.error) {
      const code = payload.error?.code ?? res.status
      const detail = payload.error?.detail ? ` — ${payload.error.detail}` : ''
      return { ok: false, error: `status=${res.status} code=${code}${detail}` }
    }
    return { ok: true, body: payload }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

function okResult(body: unknown): CallToolResult {
  return {
    structuredContent: body as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  }
}

function errorResult(msg: string): CallToolResult {
  return {
    content: [{ type: 'text', text: msg }],
    isError: true,
  }
}
