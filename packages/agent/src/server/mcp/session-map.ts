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
}

export class McpSessionMap {
  private map = new Map<string, McpSession>()

  set(mcpSessionId: string, session: McpSession): void {
    this.map.set(mcpSessionId, session)
  }

  get(mcpSessionId: string): McpSession | null {
    return this.map.get(mcpSessionId) ?? null
  }

  delete(mcpSessionId: string): void {
    this.map.delete(mcpSessionId)
  }
}
