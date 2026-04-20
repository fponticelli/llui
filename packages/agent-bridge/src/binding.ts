import type { LapDescribeResponse } from '@llui/agent/protocol'

export type Binding = {
  url: string // LAP base path, e.g. "https://app/agent/lap/v1"
  token: string
  describe: LapDescribeResponse | null // cached describe_app response; populated on bind
}

/**
 * Per-MCP-session map. Keyed by the SDK's session id (one per Claude
 * conversation). Spec §11.3.
 */
export class BindingMap {
  private map = new Map<string, Binding>()

  set(sessionId: string, url: string, token: string): void {
    this.map.set(sessionId, { url, token, describe: null })
  }
  get(sessionId: string): Binding | null {
    return this.map.get(sessionId) ?? null
  }
  setDescribe(sessionId: string, describe: LapDescribeResponse): void {
    const b = this.map.get(sessionId)
    if (b) this.map.set(sessionId, { ...b, describe })
  }
  clear(sessionId: string): void {
    this.map.delete(sessionId)
  }
  has(sessionId: string): boolean {
    return this.map.has(sessionId)
  }
}
