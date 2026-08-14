import type { LapDescribeResponse } from '../../protocol.js'

/**
 * Per-MCP-session binding. Populated by `connect_session` and read by
 * every forwarded tool handler. Keyed by the SDK-assigned MCP session ID
 * (`mcp-session-id` response header / request header).
 */
export type McpSession = {
  /** Token record ID resolved at connect_session time. */
  tid: string
  /** Bearer token — used to construct synthetic LAP requests. */
  token: string
  /**
   * Cached app `description`, populated on connect (from the `/observe`
   * bundle) and on every `describe_app` / `observe` call. Backs the
   * shared executor's `DescribeCache` so `describe_app` serves from cache
   * and a mid-session schemaHash change is detected — parity with the
   * bridge, which has always cached.
   */
  describe?: LapDescribeResponse | null
}

export class McpSessionMap {
  private map = new Map<string, McpSession>()

  /**
   * @param onBind Called when a session BINDS a token (`connect_session`),
   *   i.e. the moment an MCP session acquires an identity. The router
   *   uses it to apply its per-identity session cap at exactly that
   *   instant: the binding happens inside a tool handler, whose result
   *   is written to the response stream after `handleRequest` has already
   *   returned, so nothing on the request path can observe it in time.
   *   Not fired by `setDescribe`, which refreshes a cache, not a binding.
   */
  constructor(
    private readonly onBind: ((mcpSessionId: string, session: McpSession) => void) | null = null,
  ) {}

  set(mcpSessionId: string, session: McpSession): void {
    this.map.set(mcpSessionId, session)
    this.onBind?.(mcpSessionId, session)
  }

  get(mcpSessionId: string): McpSession | null {
    return this.map.get(mcpSessionId) ?? null
  }

  setDescribe(mcpSessionId: string, describe: LapDescribeResponse): void {
    const s = this.map.get(mcpSessionId)
    if (s) this.map.set(mcpSessionId, { ...s, describe })
  }

  delete(mcpSessionId: string): void {
    this.map.delete(mcpSessionId)
  }
}
