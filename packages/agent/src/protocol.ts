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

/**
 * Who can dispatch a Msg variant.
 *
 * - `'shared'` (default) — both UI bindings and the agent can dispatch.
 * - `'human-only'` — UI-only. Agent calls to `/message` for these variants
 *   are rejected with `LapMessageRejectReason: 'human-only'`. Use for
 *   internal UI events (focus/blur, scroll, hover) the LLM has no business
 *   triggering.
 * - `'agent-only'` — no UI binding exists. Reserved for LLM-driven flows
 *   like batch operations or "explain this state" introspection variants.
 *   Lint warns if a view references one via `send({ type: 'X' })`.
 *
 * JSDoc sugar: `@humanOnly` → `'human-only'`, `@agentOnly` → `'agent-only'`.
 * Absence of either tag → `'shared'`. The two tags are mutually exclusive
 * (enforced by `llui/agent-exclusive-annotations` ESLint rule).
 */
export type DispatchMode = 'shared' | 'human-only' | 'agent-only'

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  dispatchMode: DispatchMode
  /**
   * Concrete copy-paste example dispatches authored as `@example`
   * JSDoc tags. Multiple tags on one variant become multiple
   * entries (mix typical / edge cases without nesting strings).
   */
  examples: string[]
  /**
   * Non-blocking caution authored as `@warning`. Distinct from
   * `requiresConfirm` (runtime user gate); this informs the LLM at
   * affordance time so it can decide whether the dispatch's
   * downstream is acceptable.
   */
  warning: string | null
  /**
   * Effect kinds this variant emits when dispatched, declared via
   * `@emits("kind1", "kind2")`. Lets the agent reason about side
   * effects (cloud writes, analytics, persistent state changes)
   * before dispatching, and chunk multi-step flows accordingly
   * ("don't dispatch X 100 times — each one fires cloud/save").
   * Empty when the variant doesn't emit effects or the author hasn't
   * annotated it yet.
   */
  emits: string[]
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
    readSurfaces: readonly (
      | 'state'
      | 'query_dom'
      | 'describe_visible_content'
      | 'describe_context'
    )[]
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
    /**
     * `'shared'` — both UI and agent can dispatch. `'agent-only'` — no UI
     * binding exists; the agent is the sole dispatcher. `'human-only'`
     * variants never appear here (filtered before serialization).
     */
    dispatchMode: 'shared' | 'agent-only'
    /**
     * Where this affordance came from:
     *   - `'binding'`           — a tagged event handler is currently
     *     mounted in the rendered DOM.
     *   - `'always-affordable'` — the app's `agentAffordances(state)`
     *     hook listed it as available right now.
     *   - `'schema'`            — neither of the above; the variant
     *     is in the Msg union and annotated `@agentOnly`. The
     *     `payloadHint` carries a synthesized example from the
     *     compiler-derived field types — copy-paste-ready for
     *     `send_message`. Bulk-edit operations land here.
     */
    source: 'binding' | 'always-affordable' | 'schema'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

export type LapMessageRequest = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  /**
   * Backpressure contract for how long `/message` waits before returning:
   * - `drained` (default): dispatch, then loop until the message queue is
   *   idle for `drainQuietMs` ms or the 5s hard cap trips. Captures any
   *   effect round-trips (http/delay/debounce) that feed back as messages.
   * - `idle`: dispatch + flush + one microtask yield. Captures the
   *   synchronous update cycle but not async effects.
   * - `none`: dispatch and return without flushing. For high-throughput
   *   fire-and-forget dispatch.
   */
  waitFor?: 'drained' | 'idle' | 'none'
  /**
   * Quiescence window when `waitFor === 'drained'`. Drain completes when
   * no new update cycle fires for this many ms. Default 100ms — long
   * enough for a localhost HTTP round-trip, short enough to be
   * imperceptible. Ignored for `idle` / `none`.
   */
  drainQuietMs?: number
  /**
   * Hard cap on total wait time. When `waitFor === 'drained'`, this is
   * the upper bound on how long the drain loop can run; if reached, the
   * response carries `drain.timedOut: true` with partial results. For
   * `pending-confirmation` messages, this is how long to wait for
   * the user's confirm/reject. Default 5_000ms.
   */
  timeoutMs?: number
}

export type LapMessageRejectReason =
  | 'human-only'
  | 'user-cancelled'
  | 'timeout'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'

/**
 * Drain metadata attached to `dispatched` / `confirmed` responses.
 * `effectsObserved` counts update-cycle commits (not individual effects) —
 * it's a proxy for "how much activity happened during the drain window."
 * `errors` surfaces sync throws from `onEffect` and unhandled rejections
 * from effect handlers that fired during the drain window, so the LLM
 * can see when an HTTP handler crashed silently.
 */
export type LapDrainMeta = {
  effectsObserved: number
  durationMs: number
  timedOut: boolean
  errors: Array<{ kind: 'error' | 'unhandledrejection'; message: string; stack?: string }>
}

export type LapMessageResponse =
  | {
      status: 'dispatched'
      stateAfter: unknown
      /**
       * Structural diff from pre-dispatch state to post-drain state,
       * in JSON-Patch shape (RFC 6902 subset: `add`, `remove`,
       * `replace`). Empty when the dispatch produced no observable
       * state change. Useful when the agent wants "what changed?"
       * without diffing the full state itself; for very large states
       * this is also smaller than the full `stateAfter`. Both fields
       * are present so callers can pick whichever fits their use.
       */
      stateDiff: import('./state-diff.js').StateDiff
      actions: LapActionsResponse['actions']
      drain: LapDrainMeta
    }
  | { status: 'pending-confirmation'; confirmId: string }
  | {
      /**
       * The user approved a `pending-confirmation` message. `stateAfter`
       * is the state snapshot captured when the approve was resolved;
       * effects produced by the approved dispatch may still be in
       * flight. The LLM should follow up with an `observe` call to
       * pick up a drained view and fresh actions — by design the
       * confirm path doesn't carry drain semantics because approval
       * can arrive arbitrarily later than the original request.
       */
      status: 'confirmed'
      stateAfter: unknown
    }
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
  /**
   * Free-form idiomatic-usage examples authored by the app: typical
   * sequences of dispatches the LLM should know about, like "to
   * delete a saved matrix: dispatch Confirm/Ask first, then on
   * approve dispatch Cloud/Delete." Each entry is one example;
   * order is up to the author.
   */
  examples?: string[]
}

export type AgentContext = {
  summary: string
  hints?: string[]
  cautions?: string[]
}

export type LapContextResponse = { context: AgentContext }

// ── Unified observe ──────────────────────────────────────────────
// Single-call bootstrap. Replaces the get_state + list_actions +
// describe_app trio for the common "what can I see, what can I do"
// question. Returns the dynamic state + actions slice alongside the
// static description (name/version/messages/docs) and any
// state-derived context so one round-trip gives the LLM everything it
// needs to decide its next action.

export type LapObserveResponse = {
  state: unknown
  actions: LapActionsResponse['actions']
  description: LapDescribeResponse
  context: AgentContext | null
}

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
  '/lap/v1/observe': { req: null; res: LapObserveResponse }
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
  /**
   * Structural diff from pre-dispatch state to post-drain state, in
   * JSON-Patch shape. Populated only for `kind: 'dispatched'` entries
   * — read entries (get_state / list_actions / observe / …) don't
   * mutate state, and an empty diff would just be noise. Lets the
   * agent reconstruct what each past action did without re-fetching
   * state snapshots.
   */
  stateDiff?: import('./state-diff.js').StateDiff
}

export type HelloFrame = {
  t: 'hello'
  appName: string
  appVersion: string
  msgSchema: Record<string, MessageSchemaEntry>
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
export type ActiveFrame = { t: 'active' }

export type ServerFrame = RpcFrame | RevokedFrame | ActiveFrame

// ── Tokens + pairing ─────────────────────────────────────────────

declare const TokenBrand: unique symbol
export type AgentToken = string & { readonly [TokenBrand]: 'AgentToken' }

export type TokenPayload = {
  tid: string
  iat: number
  exp: number
  scope: 'agent'
}

export type TokenStatus =
  | 'awaiting-ws'
  | 'awaiting-claude'
  | 'active'
  | 'pending-resume'
  | 'revoked'

export type TokenRecord = {
  tid: string
  uid: string | null
  status: TokenStatus
  createdAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}

export type AgentSession = {
  tid: string
  label: string
  status: 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
}

// HTTP envelopes for the mint/resume/revoke/sessions endpoints (non-LAP).

export type MintRequest = Record<string, never>
export type MintResponse = {
  token: AgentToken
  tid: string
  wsUrl: string
  lapUrl: string
  expiresAt: number
}

export type ResumeListRequest = { tids: string[] }
export type ResumeListResponse = { sessions: AgentSession[] }

export type ResumeClaimRequest = { tid: string }
export type ResumeClaimResponse = { token: AgentToken; wsUrl: string }

export type RevokeRequest = { tid: string }
export type RevokeResponse = { status: 'revoked' }

export type SessionsResponse = { sessions: AgentSession[] }

// ── Audit ────────────────────────────────────────────────────────

export type AuditEvent =
  | 'mint'
  | 'claim'
  | 'resume'
  | 'revoke'
  | 'lap-call'
  | 'msg-dispatched'
  | 'msg-blocked'
  | 'confirm-proposed'
  | 'confirm-approved'
  | 'confirm-rejected'
  | 'rate-limited'
  | 'auth-failed'

export type AuditEntry = {
  at: number
  tid: string | null
  uid: string | null
  event: AuditEvent
  detail: object
}

// ── Codec exports ─────────────────────────────────────────────────
//
// Re-exported here so consumers can `import { ..., type AgentCodec }
// from '@llui/agent/protocol'`. The implementation lives in
// `./codecs.ts` to keep the protocol type surface together but the
// runtime registry/walkers separate.

export {
  WIRE_TAG,
  WIRE_VALUE,
  CodecRegistry,
  isoDateCodec,
  epochMillisCodec,
  makeDefaultCodecs,
  encodeForWire,
  decodeFromWire,
  type AgentCodec,
} from './codecs.js'
