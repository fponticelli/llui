import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { McpSessionMap } from './session-map.js'
import { createAgentMcpServer } from './server.js'
import type { TokenStore } from '../token-store.js'

export type McpRouterOptions = {
  /** Path prefix for the MCP endpoint. Default: '/agent/mcp'. */
  path?: string
  /** MCP server name shown in Claude Desktop. Default: 'agent'. */
  serverName?: string
  /** MCP server version string. Default: '1'. */
  serverVersion?: string
  /** Description for the connect_session tool. */
  connectDescription?: string
}

export type McpRouterDeps = {
  coreRouter: (req: Request) => Promise<Response | null>
  tokenStore: TokenStore
  lapBasePath: string
  /** Sliding (inactivity) TTL in ms; folded into the connect verify. */
  slidingTtlMs?: number
}

const DEFAULT_CONNECT_DESCRIPTION =
  'Connect to the app. Call once per chat when the user pastes a token from the app connect panel. ' +
  'Returns {state, actions, description, context} so you can start acting immediately — ' +
  'no separate observe call needed on the first turn.'

/**
 * Build a WHATWG-compatible MCP router that mounts at `opts.path`.
 * Integrates into the agent core's fetch-style router by prepending
 * this function's result in the request chain.
 *
 * Uses `WebStandardStreamableHTTPServerTransport` (WHATWG, runtime-
 * neutral) rather than the Node-only `StreamableHTTPServerTransport`.
 */
export function createMcpRouter(
  deps: McpRouterDeps,
  opts: McpRouterOptions = {},
): (req: Request) => Promise<Response | null> {
  const mcpPath = opts.path ?? '/agent/mcp'
  const serverName = opts.serverName ?? 'agent'
  const serverVersion = opts.serverVersion ?? '1'
  const connectDescription = opts.connectDescription ?? DEFAULT_CONNECT_DESCRIPTION
  const lapBasePath = deps.lapBasePath

  const sessionMap = new McpSessionMap()

  // mcp-session-id → active transport. Populated on initialize,
  // cleaned up on DELETE or transport close.
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>()

  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url)
    if (!url.pathname.startsWith(mcpPath)) return null

    const sessionHeader = req.headers.get('mcp-session-id')

    // ── Existing session ───────────────────────────────────────────
    if (sessionHeader) {
      const transport = transports.get(sessionHeader)
      if (!transport) {
        // Unknown session ID — reject so the client can reinitialize.
        return new Response(JSON.stringify({ error: 'session not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return transport.handleRequest(req)
    }

    // ── New session (no mcp-session-id) ───────────────────────────
    // Only POST (initialize) should arrive without a session ID.
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'mcp-session-id required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport)
      },
      onsessionclosed: (id) => {
        transports.delete(id)
        sessionMap.delete(id)
      },
    })

    transport.onclose = () => {
      const id = transport.sessionId
      if (id) {
        transports.delete(id)
        sessionMap.delete(id)
      }
    }

    const mcpServer = createAgentMcpServer({
      coreRouter: deps.coreRouter,
      tokenStore: deps.tokenStore,
      sessionMap,
      getSessionId: () => transport.sessionId,
      lapBasePath,
      serverName,
      serverVersion,
      connectDescription,
      slidingTtlMs: deps.slidingTtlMs,
    })

    await mcpServer.connect(transport)
    return transport.handleRequest(req)
  }
}
