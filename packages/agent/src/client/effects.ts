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
  /**
   * Schedule the next WS-reconnect attempt. The handler waits
   * `delayMs` and dispatches `ReconnectAttempt { elapsedMs: delayMs }`
   * back into the reducer, which decides whether to re-open the WS
   * or transition to `failed` based on the cumulative wait. The
   * delay schedule itself is computed reducer-side from
   * `reconnectAttempt` — this effect is a thin setTimeout wrapper.
   *
   * The handler doesn't track cancellation: if the user dispatches
   * `Disconnect` while the timer is pending, the reducer transitions
   * to `idle` and the subsequent `ReconnectAttempt` becomes a no-op
   * via the status guard. Simpler than coordinating cancel handles.
   */
  | { type: 'AgentReconnectSchedule'; delayMs: number }
  /**
   * Auto-clear the `agentAttention` spotlight after `delayMs`. The
   * handler waits and dispatches `Clear { entryId }` back into the
   * attention slice via `wrapAgentAttention`. The clear is conditional
   * (matches `entryId` against `latestDispatch.entryId` in the reducer),
   * so a fast follow-up dispatch isn't wiped by the previous dispatch's
   * pending timer — same race-avoidance pattern as
   * `AgentReconnectSchedule`'s status guard.
   *
   * No cancel handle: the handler is a thin `setTimeout` wrapper. If
   * the host doesn't wire `wrapAttentionMsg` in the factory, the
   * handler no-ops and the spotlight stays set until the next dispatch
   * overwrites it (graceful degradation — the activity log still
   * works, just without auto-clearing visual highlights).
   */
  | { type: 'AgentAttentionFlashTimeout'; entryId: string; delayMs: number }

// Handler implementation lands in Plan 7 alongside the WS client.
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
