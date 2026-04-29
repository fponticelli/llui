import type { AgentToken } from '../protocol.js'

export type AgentEffect =
  /**
   * Mint a fresh agent token. `mintUrl` is optional — when omitted the
   * effect handler derives it from `EffectHandlerHost.agentBasePath`
   * (default `/agent`), producing `<agentBasePath>/mint`. Pass an
   * explicit value when the mint endpoint lives outside the configured
   * base path.
   */
  | { type: 'AgentMintRequest'; mintUrl?: string }
  | { type: 'AgentOpenWS'; token: AgentToken; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck'; tids: string[] }
  | { type: 'AgentResumeClaim'; tid: string }
  | { type: 'AgentRevoke'; tid: string }
  | { type: 'AgentSessionsList' }
  | { type: 'AgentForwardMsg'; payload: unknown }
  // Handler reads `text` (no state lookup needed at handler time —
  // update() resolved it from the current state.pendingToken). Lets
  // the static-bag `connect()` shape avoid leaking state-reads into
  // event handlers.
  | { type: 'AgentClipboardWrite'; text: string }
  /**
   * Persist active session credentials so a page refresh can restore
   * the same WS without re-minting (and without invalidating the
   * agent's token via the rotate-on-resume path). Hosts typically
   * write to `sessionStorage` so the credentials are tab-scoped:
   * survive refresh, die on tab close. The framework emits this on
   * `MintSucceeded`; the matching `AgentSessionClear` is emitted on
   * `Revoke` of the active tid. Hosts that don't implement the
   * persist/restore loop can ignore both — the rest of the connect
   * lifecycle still works (the page just falls back to "mint a new
   * session" after refresh, same as before this effect existed).
   */
  | {
      type: 'AgentSessionPersist'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  | { type: 'AgentSessionClear' }

// Handler implementation lands in Plan 7 alongside the WS client.
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
