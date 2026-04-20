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

// Handler implementation lands in Plan 7 alongside the WS client.
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
