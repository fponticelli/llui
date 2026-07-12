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

  set(mcpSessionId: string, session: McpSession): void {
    this.map.set(mcpSessionId, session)
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
