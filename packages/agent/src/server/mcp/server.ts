import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  FORWARDED_TOOL_DESCRIPTORS,
  DISCONNECT_SESSION_DESCRIPTOR,
  type McpForwardedToolDescriptor,
} from '../../mcp/tools.js'
import {
  okResult,
  errorResult,
  executeForwardedTool,
  executeConnect,
  type LapCaller,
  type LapEnvelope,
  type DescribeCache,
} from '../../mcp/executor.js'
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
  /** Sliding (inactivity) TTL in ms; folded into the connect verify. */
  slidingTtlMs?: number
}

/**
 * Build one `McpServer` instance for a single MCP session. Tool handlers
 * call LAP endpoints via synthetic WHATWG Requests routed through
 * `coreRouter` — no extra HTTP round-trip to localhost needed. The
 * forwarded-tool dispatch, describe cache, connect prefetch, and result
 * shaping are shared with the bridge via `@llui/agent/mcp/executor`.
 */
export function createAgentMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: deps.serverName, version: deps.serverVersion },
    { capabilities: { tools: {} } },
  )

  // In-process LAP caller: construct a synthetic WHATWG Request for the
  // given token and route it through the agent core's router.
  const callerFor = (token: string): LapCaller => {
    return async (lapPath, body) => lapCall(deps.coreRouter, token, deps.lapBasePath, lapPath, body)
  }

  // Per-session describe cache backed by the session map.
  const cacheFor = (sessionId: string): DescribeCache => ({
    get: () => deps.sessionMap.get(sessionId)?.describe ?? null,
    set: (d) => deps.sessionMap.setDescribe(sessionId, d),
  })

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
      const auth = await verifyAndReadTid(authReq, deps.tokenStore, {
        slidingTtlMs: deps.slidingTtlMs,
      })
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

      // Prefetch the observe bundle + cache the description — shared with
      // the bridge so both surfaces hand back the same connected shape.
      return executeConnect(callerFor(token), cacheFor(sessionId), () =>
        deps.sessionMap.delete(sessionId),
      )
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
    registerForwardedTool(server, deps, callerFor, cacheFor, desc)
  }

  return server
}

function registerForwardedTool(
  server: McpServer,
  deps: McpServerDeps,
  callerFor: (token: string) => LapCaller,
  cacheFor: (sessionId: string) => DescribeCache,
  desc: McpForwardedToolDescriptor,
): void {
  server.registerTool(
    desc.name,
    { description: desc.description, inputSchema: desc.schema.shape },
    async (args) => {
      const sessionId = deps.getSessionId()
      const session = sessionId ? deps.sessionMap.get(sessionId) : null
      if (!session || !sessionId) {
        return errorResult(
          'Not connected — ask the user to copy the token from the app connect panel ' +
            'and call connect_session with it.',
        )
      }
      return executeForwardedTool(
        desc,
        (args ?? {}) as Record<string, unknown>,
        callerFor(session.token),
        cacheFor(sessionId),
      )
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
  body: object,
): Promise<LapEnvelope> {
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
    if (!res) return { ok: false, status: 404, error: { code: 'no-handler', detail: lapPath } }
    const payload = (await res.json()) as { error?: { code: string; detail?: string } }
    if (!res.ok || payload.error) return { ok: false, status: res.status, error: payload }
    return { ok: true, body: payload }
  } catch (e) {
    return { ok: false, status: 0, error: { code: 'internal', detail: String(e) } }
  }
}
