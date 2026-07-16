import type { ClientFrame, HelloFrame, LogEntry, LogKind, MessageAnnotations } from '../protocol.js'
import { LAP_VERSION, parseServerFrame } from '../protocol.js'
import { handleGetState, type GetStateHost } from './rpc/get-state.js'
import { handleQueryState, type QueryStateHost } from './rpc/query-state.js'
import { handleWouldDispatch, type WouldDispatchHost } from './rpc/would-dispatch.js'
import { handleSendMessage, type SendMessageHost } from './rpc/send-message.js'
import { handleListActions, type ListActionsHost } from './rpc/list-actions.js'
import { handleQueryDom, type QueryDomHost } from './rpc/query-dom.js'
import {
  handleDescribeVisibleContent,
  type DescribeVisibleHost,
} from './rpc/describe-visible-content.js'
import {
  handleDescribeContext,
  type DescribeContextHost,
  type LastDispatchOutcome,
} from './rpc/describe-context.js'
import { handleObserve, type ObserveHost } from './rpc/observe.js'

export interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(event: 'message', h: (e: { data: string | ArrayBuffer }) => void): void
  addEventListener(event: 'open' | 'close', h: () => void): void
}

export type RpcHosts = GetStateHost &
  QueryStateHost &
  SendMessageHost &
  ListActionsHost &
  QueryDomHost &
  DescribeVisibleHost &
  DescribeContextHost &
  ObserveHost &
  WouldDispatchHost

export type HelloBuilder = () => HelloFrame

export type WsClient = {
  /** Resolve a pending confirmation; emits confirm-resolved frame to the server. */
  resolveConfirm(
    confirmId: string,
    outcome: 'confirmed' | 'user-cancelled',
    stateAfter?: unknown,
  ): void
  /**
   * Emit a state-update frame answering a specific server watch (`id`).
   * The server correlates by `id`, so only an armed `/wait` receives it.
   * Dropped silently if the socket isn't OPEN (see finding: never let a
   * send during CONNECTING throw into the host commit cycle).
   */
  emitStateUpdate(id: string, path: string, stateAfter: unknown): void
  /** Emit a log-append frame so the server can mirror client-observed actions to the audit sink. */
  emitLogAppend(entry: LogEntry): void
  /** Whether the underlying socket has fired `open` and not yet `close`. */
  isOpen(): boolean
  /** Close the socket cleanly. */
  close(): void
}

export type WsClientOpts = {
  /** Called once when the server sends an `{t: 'active'}` frame. Idempotent. */
  onActivated?: () => void
  /**
   * Called with every LogEntry emitted by the ws-client (one per rpc
   * dispatched or errored). Used by the factory to mirror the entries
   * into the app's local `agent.log` slice so the UI can show activity.
   * The ws-client still sends the outbound `log-append` frame to the
   * server regardless.
   */
  onLogEntry?: (entry: LogEntry) => void
  /**
   * Called with the outcome of every `send_message` rpc — `dispatched`
   * (with optional errors / warnings), `rejected` (with errors), or
   * `reducer-threw`. The factory uses this to maintain a "last
   * outcome" snapshot that `describe_context` injects as a synthetic
   * hint, so apps don't have to maintain their own
   * `lastDispatchError` state field.
   */
  onDispatchOutcome?: (outcome: LastDispatchOutcome | null) => void
  /**
   * Called when the server sends a `confirm-expire` frame — the server
   * has told the agent a confirm is terminally rejected, so the browser
   * must expire the matching pending confirm entry to prevent a late
   * user Approve from firing a now-dead dispatch. Idempotent.
   */
  onConfirmExpire?: (confirmId: string) => void
  /**
   * Called when the server arms a state watch (`/wait` began). The
   * factory records a baseline for `path` and, on each subsequent
   * commit, emits a `state-update` for `id` iff the resolved value
   * changed. Absent → no state-update traffic is ever produced.
   */
  onWatch?: (id: string, path: string | undefined) => void
  /** Called when the server disarms a watch (`/wait` resolved / timed out). */
  onUnwatch?: (id: string) => void
  /**
   * Encode a value for the wire at the frame boundary — applied to
   * every state-bearing OUTBOUND frame (rpc-reply, state-update,
   * log-append, confirm-resolved). App callbacks and pointer resolution
   * run on the raw (redacted-but-unencoded) state; codec encoding
   * (Date → tagged form, etc.) happens ONLY here, once, as the frame
   * leaves. Defaults to identity when omitted (tests / no codecs).
   */
  encodeWire?: (value: unknown) => unknown
}

/**
 * Wires up a WebSocket to serve rpc requests from the server.
 */
export function attachWsClient(
  ws: WsLike,
  rpc: RpcHosts,
  hello: HelloBuilder,
  opts: WsClientOpts = {},
): WsClient {
  let activated = false
  let open = false
  const encodeWire = opts.encodeWire ?? ((v: unknown) => v)

  // Single outbound seam. Encodes state-bearing frames at the wire
  // boundary and never throws into the caller — a send attempted while
  // the socket is CONNECTING / CLOSING would otherwise raise
  // `InvalidStateError` straight into whatever drove the send (e.g. the
  // host's state-commit cycle for state-update).
  const sendFrame = (frame: ClientFrame): void => {
    try {
      ws.send(JSON.stringify(encodeWire(frame)))
    } catch {
      // Socket not open / already closing — drop. State-update is the
      // only frame emitted outside an inbound-message handler, and a
      // dropped update just means the next armed watch re-reads.
    }
  }

  ws.addEventListener('open', () => {
    open = true
    // Hello is sent raw (its affordances sample is already redacted; it
    // carries no state that needs codec encoding on this path).
    try {
      ws.send(JSON.stringify(hello()))
    } catch {
      /* extremely unlikely on the open event itself */
    }
  })
  ws.addEventListener('close', () => {
    open = false
  })
  ws.addEventListener('message', async (ev) => {
    let json: unknown
    try {
      const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
      json = JSON.parse(raw)
    } catch {
      return
    }
    // Validate the frame envelope at the boundary rather than trusting an
    // unchecked `as ServerFrame`. An invalid frame that is nonetheless a
    // recognizable rpc REQUEST gets an rpc-error reply so the server's
    // pending rpc settles instead of hanging until timeout; anything else
    // is dropped with a warning.
    const frame = parseServerFrame(json)
    if (!frame) {
      const maybe = json as { t?: unknown; id?: unknown }
      if (
        maybe !== null &&
        typeof maybe === 'object' &&
        maybe.t === 'rpc' &&
        typeof maybe.id === 'string'
      ) {
        sendFrame({
          t: 'rpc-error',
          id: maybe.id,
          code: 'schema-error',
          detail: 'invalid server frame',
        })
      } else {
        console.warn(`[llui-agent] dropping invalid server frame: ${String(maybe?.t)}`)
      }
      return
    }
    if (frame.t === 'hello-ack') {
      // Version negotiation. The server independently terminates the
      // pairing when this client is too old; surface the incompatibility
      // here too so it's diagnosable rather than a silent socket drop.
      if (LAP_VERSION < frame.minClientVersion) {
        console.warn(
          `[llui-agent] LAP version too old: client speaks v${LAP_VERSION}, server requires >= v${frame.minClientVersion}`,
        )
      }
      return
    }
    if (frame.t === 'revoked') {
      ws.close()
      return
    }
    if (frame.t === 'active') {
      if (!activated) {
        activated = true
        opts.onActivated?.()
      }
      return
    }
    if (frame.t === 'confirm-expire') {
      opts.onConfirmExpire?.(frame.confirmId)
      return
    }
    if (frame.t === 'watch') {
      opts.onWatch?.(frame.id, frame.path)
      return
    }
    if (frame.t === 'unwatch') {
      opts.onUnwatch?.(frame.id)
      return
    }
    if (frame.t === 'log-push') {
      // Server-originated log entry (today: agent narration). Mirror
      // it via the same `onLogEntry` channel as locally-emitted entries
      // so agentLog/agentAttention pick it up. Then echo a `log-append`
      // back to the server so the recent-log buffer + audit sink see
      // it through the existing browser → server path — no special
      // server-side persistence for narration.
      opts.onLogEntry?.(frame.entry)
      sendFrame({ t: 'log-append', entry: frame.entry })
      return
    }
    if (frame.t !== 'rpc') {
      // Unknown / unhandled server frame type. Log once so drift between
      // the server's frame vocabulary and this client is visible instead
      // of being silently ignored.
      console.warn(
        `[llui-agent] ignoring unknown server frame type: ${String((frame as { t?: unknown }).t)}`,
      )
      return
    }
    let result: unknown
    let rpcErr: { code?: string; detail?: string } | null = null
    try {
      result = await dispatch(frame.tool, frame.args, rpc)
      // encodeWire runs inside sendFrame: the handler produced raw
      // (redacted-but-unencoded) state, encoded to wire form here.
      sendFrame({ t: 'rpc-reply', id: frame.id, result })
    } catch (e: unknown) {
      rpcErr = e as { code?: string; detail?: string }
      // When a plain JS exception bubbles up (TypeError, RangeError, etc.),
      // rpcErr has no .code/.detail. Enrich the detail with the actual
      // message + stack so the server/Claude can see the real cause.
      const detail =
        rpcErr.detail ??
        (e instanceof Error
          ? `${e.name}: ${e.message}${e.stack ? '\n' + e.stack.split('\n').slice(0, 5).join('\n') : ''}`
          : undefined)
      sendFrame({
        t: 'rpc-error',
        id: frame.id,
        code: rpcErr.code ?? 'internal',
        detail,
      })
      // Also log to the browser console so operators see the real cause even
      // when the server/Claude just show "internal".
      console.error(`[llui-agent] rpc handler threw for ${frame.tool}:`, e)
    }
    const kind = getLogKindForTool(frame.tool, result, rpcErr)
    const detail = buildDetail(frame.tool, frame.args)
    const logEntry: LogEntry = {
      id: frame.id,
      at: Date.now(),
      kind,
      variant: extractVariant(frame.tool, frame.args),
      intent: buildIntent(frame.tool, frame.args, rpc.getMsgAnnotations()),
      ...(detail !== undefined ? { detail } : {}),
    }
    // For successful send_message dispatches, the stateDiff is part
    // of the response. Lifting it into the log entry means the agent
    // can read its own past actions with full "what changed" detail
    // without re-querying state — essential for self-correcting
    // behavior over multi-step flows.
    if (frame.tool === 'send_message' && rpcErr === null && isDispatchedResult(result)) {
      logEntry.stateDiff = result.stateDiff
    }
    if (frame.tool === 'send_message') {
      // Capture the outcome so `describe_context` can surface it as a
      // synthetic "Last dispatch …" hint. Apps used to roll their
      // own `lastDispatchError` field; the framework owns it now.
      const outcome = extractDispatchOutcome(frame.args, result, rpcErr)
      if (outcome !== null) opts.onDispatchOutcome?.(outcome)
    }
    // Local slices receive the RAW entry (real Date values render better
    // in the in-app log than tagged wire form); the wire copy is encoded
    // inside sendFrame.
    opts.onLogEntry?.(logEntry)
    sendFrame({ t: 'log-append', entry: logEntry })
  })

  return {
    resolveConfirm(confirmId, outcome, stateAfter) {
      sendFrame({ t: 'confirm-resolved', confirmId, outcome, stateAfter })
    },
    emitStateUpdate(id, path, stateAfter) {
      // Guard: never send while CONNECTING/CLOSING (finding 8). sendFrame
      // also try/catches, but the explicit open-check avoids the throw
      // path entirely and documents intent.
      if (!open) return
      sendFrame({ t: 'state-update', id, path, stateAfter })
    },
    emitLogAppend(entry) {
      sendFrame({ t: 'log-append', entry })
    },
    isOpen() {
      return open
    },
    close() {
      ws.close()
    },
  }
}

async function dispatch(tool: string, args: unknown, rpc: RpcHosts): Promise<unknown> {
  switch (tool) {
    case 'get_state':
      return handleGetState(rpc, (args ?? {}) as { path?: string })
    case 'query_state':
      return handleQueryState(rpc, (args ?? {}) as { path: string })
    case 'list_actions':
      return handleListActions(rpc)
    case 'send_message':
      return handleSendMessage(rpc, args as never)
    case 'query_dom':
      return handleQueryDom(rpc, args as never)
    case 'describe_visible_content':
      return handleDescribeVisibleContent(rpc)
    case 'describe_context':
      return handleDescribeContext(rpc)
    case 'observe':
      return handleObserve(rpc)
    case 'would_dispatch':
      return handleWouldDispatch(rpc, args as never)
    default:
      throw { code: 'invalid', detail: `unknown tool: ${tool}` }
  }
}

const READ_TOOLS = new Set([
  'get_state',
  'query_state',
  'list_actions',
  'describe_context',
  'query_dom',
  'describe_visible_content',
  'observe',
  'would_dispatch',
])

function getLogKindForTool(
  tool: string,
  result: unknown,
  err: { code?: string; detail?: string } | null,
): LogKind {
  if (err !== null) return 'error'
  if (tool === 'send_message') {
    const r = result as { status?: string } | null
    const status = r?.status
    if (status === 'dispatched' || status === 'confirmed') return 'dispatched'
    if (status === 'pending-confirmation') return 'proposed'
    if (status === 'rejected') return 'blocked'
    return 'dispatched'
  }
  if (READ_TOOLS.has(tool)) return 'read'
  return 'read'
}

/**
 * Type guard for the `dispatched` shape of `LapMessageResponse`.
 * Used to lift the stateDiff into the log entry without polluting
 * the type chain with cross-cutting imports.
 */
function isDispatchedResult(
  result: unknown,
): result is { status: 'dispatched'; stateDiff: import('../state-diff.js').StateDiff } {
  return (
    result !== null &&
    typeof result === 'object' &&
    (result as { status?: unknown }).status === 'dispatched' &&
    Array.isArray((result as { stateDiff?: unknown }).stateDiff)
  )
}

/**
 * Build a `LastDispatchOutcome` snapshot from the send_message rpc's
 * result/error pair. Returns null when the args don't carry a variant
 * name (malformed dispatch — would never have been logged anyway).
 *
 * Status mapping:
 *   - { status: 'dispatched' }                        → 'dispatched' (with errors/warnings)
 *   - { status: 'rejected' }                          → 'rejected'
 *   - rpcErr (rpc handler threw, including reducer-throw on the predict path) → 'reducer-threw'
 *
 * The outcome is consumed by `describe_context` to prepend a synthetic
 * "Last dispatch …" hint. Clean dispatched outcomes (no errors, no
 * warnings) still get tracked — `formatLastOutcomeHint` decides whether
 * to surface them.
 */
function extractDispatchOutcome(
  args: unknown,
  result: unknown,
  rpcErr: { code?: string; detail?: string } | null,
): LastDispatchOutcome | null {
  const variant = extractVariant('send_message', args)
  if (variant === undefined) return null

  const at = Date.now()

  if (rpcErr !== null) {
    // The rpc handler itself threw — most often this is a reducer
    // throw that bubbled past the catch in send-message.ts (e.g.
    // would_dispatch's reducer threw in a non-send-message tool that
    // shares the path). Treat as `reducer-threw` so the agent reads
    // "state may be partially advanced; observe before retrying."
    return {
      variant,
      status: 'reducer-threw',
      errors: [{ message: rpcErr.detail ?? rpcErr.code ?? 'rpc handler threw' }],
      at,
    }
  }
  if (result === null || typeof result !== 'object') return null
  const r = result as {
    status?: string
    drain?: {
      errors?: ReadonlyArray<{ message: string }>
      warnings?: ReadonlyArray<{ path: string; message: string }>
    }
    detail?: string
  }
  if (r.status === 'dispatched') {
    const errors = r.drain?.errors ?? []
    const warnings = r.drain?.warnings ?? []
    const out: LastDispatchOutcome = { variant, status: 'dispatched', at }
    if (errors.length > 0) out.errors = errors
    if (warnings.length > 0) out.warnings = warnings
    return out
  }
  if (r.status === 'rejected') {
    const detail = r.detail ?? 'rejected'
    return {
      variant,
      status: 'rejected',
      errors: [{ message: detail }],
      at,
    }
  }
  // Other statuses (`pending-confirmation`, etc.) — don't update the
  // last-outcome cache. The dispatch hasn't really concluded yet.
  return null
}

function extractVariant(tool: string, args: unknown): string | undefined {
  if (tool === 'send_message') {
    const a = args as { msg?: { type?: string } } | null
    const t = a?.msg?.type
    return typeof t === 'string' ? t : undefined
  }
  return undefined
}

// Human-readable label for each rpc. For send_message, prefer the @intent
// annotation authored on the Msg union; fall back to the raw variant name.
// For read tools, return a short fixed label so the activity feed doesn't
// show opaque tool ids like "describe_visible_content".
function buildIntent(
  tool: string,
  args: unknown,
  annotations: Record<string, MessageAnnotations> | null,
): string {
  if (tool === 'send_message') {
    const a = args as { msg?: { type?: string } } | null
    const variant = typeof a?.msg?.type === 'string' ? a.msg.type : undefined
    const annotated = variant ? annotations?.[variant]?.intent : null
    if (annotated) return annotated
    return variant ?? 'Send message'
  }
  if (tool === 'get_state') return 'Read app state'
  if (tool === 'query_state') return 'Read state slice'
  if (tool === 'list_actions') return 'List available actions'
  if (tool === 'describe_context') return 'Read current context'
  if (tool === 'describe_visible_content') return 'Read visible content'
  if (tool === 'query_dom') {
    const a = args as { name?: string } | null
    return a?.name ? `Query DOM: ${a.name}` : 'Query DOM'
  }
  return tool
}

// Maximum number of payload fields rendered into a detail line. Three
// is enough to see the discriminating values (id + a couple of meaningful
// args) without overflowing the activity-feed row.
const DETAIL_MAX_FIELDS = 3
// Per-value truncation. Activity-feed rows are short; long strings, base64,
// or large JSON blobs would dominate the line otherwise.
const DETAIL_MAX_VALUE_LEN = 30

/**
 * One-line summary of the rpc's payload for the activity feed. Sits below
 * `intent` (the human-authored "what action") and answers "with what
 * arguments". Schema-free: enumerates the first few non-`type` fields
 * of the Msg payload (or the rpc args, for read tools that take args)
 * and renders them as `k=v` pairs with bounded value length.
 *
 * Returns `undefined` for tools whose payload is uninteresting (no args,
 * or args that the intent line already covers — e.g. `query_dom`'s name
 * is already in the intent). The activity feed only renders the detail
 * row when this returns a string.
 *
 * Why schema-free: requires no schema lookup, no `MessageAnnotations`
 * dependency, runs synchronously in the rpc dispatch path. A future
 * iteration can use the per-field `@should` hints from `MessageSchemaEntry`
 * to render labels (e.g. `the alternative id: a3` instead of `id=a3`),
 * but that's additive — the schema-free baseline guarantees every
 * dispatched message gets a detail line, even for variants the schema
 * extractor missed.
 */
function buildDetail(tool: string, args: unknown): string | undefined {
  if (tool !== 'send_message') return undefined
  const a = args as { msg?: Record<string, unknown> } | null
  const msg = a?.msg
  if (!msg || typeof msg !== 'object') return undefined
  const fields: string[] = []
  let count = 0
  for (const key of Object.keys(msg)) {
    if (key === 'type') continue
    if (count >= DETAIL_MAX_FIELDS) {
      // Indicate truncation so callers know more fields exist.
      fields.push('…')
      break
    }
    fields.push(`${key}=${formatDetailValue(msg[key])}`)
    count++
  }
  if (fields.length === 0) return undefined
  return fields.join(' ')
}

function formatDetailValue(value: unknown): string {
  let s: string
  if (value === null) s = 'null'
  else if (value === undefined) s = 'undefined'
  else if (typeof value === 'string')
    s = JSON.stringify(value) // quotes mark string-ness
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value)
  else if (Array.isArray(value)) s = `[${value.length}]`
  else if (typeof value === 'object') {
    // Show the keys, not a serialized blob — the agent panel is for
    // glanceable identity, not for full payload inspection (the tool's
    // own response carries that). `{a,b,c}` reads at a glance.
    const keys = Object.keys(value as Record<string, unknown>)
    s = keys.length === 0 ? '{}' : `{${keys.slice(0, 3).join(',')}${keys.length > 3 ? ',…' : ''}}`
  } else {
    s = String(value)
  }
  return s.length > DETAIL_MAX_VALUE_LEN ? s.slice(0, DETAIL_MAX_VALUE_LEN - 1) + '…' : s
}
