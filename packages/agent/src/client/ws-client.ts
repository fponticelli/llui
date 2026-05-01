import type {
  ClientFrame,
  ServerFrame,
  HelloFrame,
  LogEntry,
  LogKind,
  MessageAnnotations,
} from '../protocol.js'
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
  /** Emit a state-update frame so the server can resolve waitForChange promises. */
  emitStateUpdate(path: string, stateAfter: unknown): void
  /** Emit a log-append frame so the server can mirror client-observed actions to the audit sink. */
  emitLogAppend(entry: LogEntry): void
  /**
   * Send a user chat-composer submission upstream and synthesize a
   * matching `LogEntry { kind: 'user-input' }` for the local activity
   * feed. The agent picks up `text` via `wait_for_user_input`. `at`
   * defaults to `Date.now()` — pass an explicit timestamp when the
   * caller already captured one (e.g. on the keystroke that fired
   * Enter, vs. the microtask later that finally calls this).
   */
  submitUserInput(text: string, at?: number): void
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
}

/**
 * Wires up a WebSocket to serve rpc requests from the server. See spec §9.4.
 */
export function attachWsClient(
  ws: WsLike,
  rpc: RpcHosts,
  hello: HelloBuilder,
  opts: WsClientOpts = {},
): WsClient {
  let activated = false
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(hello()))
  })
  ws.addEventListener('message', async (ev) => {
    let frame: ServerFrame
    try {
      const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
      frame = JSON.parse(raw) as ServerFrame
    } catch {
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
    if (frame.t !== 'rpc') return
    let result: unknown
    let rpcErr: { code?: string; detail?: string } | null = null
    try {
      result = await dispatch(frame.tool, frame.args, rpc)
      const reply: ClientFrame = { t: 'rpc-reply', id: frame.id, result }
      ws.send(JSON.stringify(reply))
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
      const errFrame: ClientFrame = {
        t: 'rpc-error',
        id: frame.id,
        code: rpcErr.code ?? 'internal',
        detail,
      }
      ws.send(JSON.stringify(errFrame))
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
    opts.onLogEntry?.(logEntry)
    ws.send(JSON.stringify({ t: 'log-append', entry: logEntry } satisfies ClientFrame))
  })

  return {
    resolveConfirm(confirmId, outcome, stateAfter) {
      const frame: ClientFrame = {
        t: 'confirm-resolved',
        confirmId,
        outcome,
        stateAfter,
      }
      ws.send(JSON.stringify(frame))
    },
    emitStateUpdate(path, stateAfter) {
      const frame: ClientFrame = { t: 'state-update', path, stateAfter }
      ws.send(JSON.stringify(frame))
    },
    emitLogAppend(entry) {
      const frame: ClientFrame = { t: 'log-append', entry }
      ws.send(JSON.stringify(frame))
    },
    submitUserInput(text, at = Date.now()) {
      // Two side effects, in order:
      //
      //  1. Send the WS frame so the server's `wait_for_user_input`
      //     waiters resolve with the user's text. This is the
      //     conversational delivery — the agent picks it up at the
      //     next LAP poll.
      //  2. Synthesize a `LogEntry { kind: 'user-input', detail: text }`
      //     and call `onLogEntry` so the local agent panel renders the
      //     user's reply inline with agent actions. The same entry is
      //     ALSO mirrored to the server via `log-append` (the existing
      //     emit path covers it) so `describe_recent_actions` shows
      //     the user's words in conversational order — agents reading
      //     past activity see the back-and-forth as one timeline.
      //
      // The frame's `t === 'user-input-submitted'` is what
      // `wait_for_user_input` keys off; the LogEntry is purely for
      // human-visible activity feeds.
      const inputFrame: ClientFrame = { t: 'user-input-submitted', text, at }
      ws.send(JSON.stringify(inputFrame))
      const id = `user-input-${at}-${Math.random().toString(36).slice(2, 8)}`
      const entry: LogEntry = {
        id,
        at,
        kind: 'user-input',
        detail: text,
        intent: 'User input',
      }
      opts.onLogEntry?.(entry)
      const logFrame: ClientFrame = { t: 'log-append', entry }
      ws.send(JSON.stringify(logFrame))
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
