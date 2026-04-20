// ── LAP — LLui Agent Protocol ────────────────────────────────────
// JSON over HTTPS between the llui-agent bridge (MCP side) and the
// @llui/agent server library mounted in the developer's backend.
// See docs/superpowers/specs/2026-04-19-llui-agent-design.md §7.

export type LapErrorCode =
  | 'auth-failed'
  | 'revoked'
  | 'paused'
  | 'rate-limited'
  | 'invalid'
  | 'schema-error'
  | 'timeout'
  | 'internal'

export type LapError = {
  error: {
    code: LapErrorCode
    detail?: string
    retryAfterMs?: number
  }
}

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

export type MessageSchemaEntry = {
  payloadSchema: object
  annotations: MessageAnnotations
}

export type LapDescribeResponse = {
  name: string
  version: string
  stateSchema: object
  messages: Record<string, MessageSchemaEntry>
  docs: AgentDocs | null
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: readonly ('state' | 'query_dom' | 'describe_visible_content' | 'describe_context')[]
  }
  schemaHash: string
}

export type LapStateRequest = { path?: string }
export type LapStateResponse = { state: unknown }

export type LapActionsResponse = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

export type LapMessageRequest = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  waitFor?: 'idle' | 'none'
  timeoutMs?: number
}

export type LapMessageRejectReason =
  | 'humanOnly'
  | 'user-cancelled'
  | 'timeout'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'

export type LapMessageResponse =
  | { status: 'dispatched'; stateAfter: unknown }
  | { status: 'pending-confirmation'; confirmId: string }
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: LapMessageRejectReason; detail?: string }

export type LapConfirmResultRequest = { confirmId: string; timeoutMs?: number }
export type LapConfirmResultResponse =
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: 'user-cancelled' | 'timeout' }
  | { status: 'still-pending' }

export type LapWaitRequest = { path?: string; timeoutMs?: number }
export type LapWaitResponse =
  | { status: 'changed'; stateAfter: unknown }
  | { status: 'timeout'; stateAfter: unknown }

export type LapQueryDomRequest = { name: string; multiple?: boolean }
export type LapQueryDomResponse = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}

export type OutlineNode =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: OutlineNode[] }
  | { kind: 'item'; text: string; children?: OutlineNode[] }
  | { kind: 'button'; text: string; disabled: boolean; actionVariant: string | null }
  | { kind: 'input'; label: string | null; value: string | null; type: string }
  | { kind: 'link'; text: string; href: string }

export type LapDescribeVisibleResponse = { outline: OutlineNode[] }

// ── App + context documentation ──────────────────────────────────
// Static app-level docs (authored once on the component record) and
// dynamic per-state context docs (pure function of state, served by
// `/lap/v1/context`). See spec §5.4.

export type AgentDocs = {
  purpose: string
  overview?: string
  cautions?: string[]
}

export type AgentContext = {
  summary: string
  hints?: string[]
  cautions?: string[]
}

export type LapContextResponse = { context: AgentContext }

// LAP endpoint catalog — a compile-time map binding each path to its
// request/response shape. Useful for the bridge's dispatcher and for
// typed test helpers.
export type LapEndpointMap = {
  '/lap/v1/describe': { req: null; res: LapDescribeResponse }
  '/lap/v1/state': { req: LapStateRequest; res: LapStateResponse }
  '/lap/v1/actions': { req: null; res: LapActionsResponse }
  '/lap/v1/message': { req: LapMessageRequest; res: LapMessageResponse }
  '/lap/v1/confirm-result': { req: LapConfirmResultRequest; res: LapConfirmResultResponse }
  '/lap/v1/wait': { req: LapWaitRequest; res: LapWaitResponse }
  '/lap/v1/query-dom': { req: LapQueryDomRequest; res: LapQueryDomResponse }
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
  '/lap/v1/context': { req: null; res: LapContextResponse }
}

export type LapPath = keyof LapEndpointMap
export type LapRequest<P extends LapPath> = LapEndpointMap[P]['req']
export type LapResponse<P extends LapPath> = LapEndpointMap[P]['res']

// ── Relay WS frames ──────────────────────────────────────────────
// Bidirectional framing between the LLui runtime in the browser and
// the @llui/agent server over /agent/ws. See spec §10.5.

export type LogKind =
  | 'proposed'
  | 'dispatched'
  | 'confirmed'
  | 'rejected'
  | 'blocked'
  | 'read'
  | 'error'

export type LogEntry = {
  id: string
  at: number
  kind: LogKind
  variant?: string
  intent?: string
  detail?: string
}

export type HelloFrame = {
  t: 'hello'
  appName: string
  appVersion: string
  msgSchema: object
  stateSchema: object
  affordancesSample: object[]
  docs: AgentDocs | null
  schemaHash: string
}

export type RpcReplyFrame = { t: 'rpc-reply'; id: string; result: unknown }
export type RpcErrorFrame = { t: 'rpc-error'; id: string; code: string; detail?: string }
export type ConfirmResolvedFrame = {
  t: 'confirm-resolved'
  confirmId: string
  outcome: 'confirmed' | 'user-cancelled'
  stateAfter?: unknown
}
export type StateUpdateFrame = { t: 'state-update'; path: string; stateAfter: unknown }
export type LogAppendFrame = { t: 'log-append'; entry: LogEntry }

export type ClientFrame =
  | HelloFrame
  | RpcReplyFrame
  | RpcErrorFrame
  | ConfirmResolvedFrame
  | StateUpdateFrame
  | LogAppendFrame

export type RpcFrame = { t: 'rpc'; id: string; tool: string; args: unknown }
export type RevokedFrame = { t: 'revoked' }

export type ServerFrame = RpcFrame | RevokedFrame
