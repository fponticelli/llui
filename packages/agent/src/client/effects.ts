import type { AgentToken } from '../protocol.js'

export type AgentEffect =
  | { type: 'AgentMintRequest'; mintUrl: string }
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

// Handler implementation lands in Plan 7 alongside the WS client.
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
