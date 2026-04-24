import type {
  ClientFrame,
  ServerFrame,
  HelloFrame,
  LogEntry,
  LogKind,
  MessageAnnotations,
} from '../protocol.js'
import { handleGetState, type GetStateHost } from './rpc/get-state.js'
import { handleSendMessage, type SendMessageHost } from './rpc/send-message.js'
import { handleListActions, type ListActionsHost } from './rpc/list-actions.js'
import { handleQueryDom, type QueryDomHost } from './rpc/query-dom.js'
import {
  handleDescribeVisibleContent,
  type DescribeVisibleHost,
} from './rpc/describe-visible-content.js'
import { handleDescribeContext, type DescribeContextHost } from './rpc/describe-context.js'
import { handleObserve, type ObserveHost } from './rpc/observe.js'

export interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(event: 'message', h: (e: { data: string | ArrayBuffer }) => void): void
  addEventListener(event: 'open' | 'close', h: () => void): void
}

export type RpcHosts = GetStateHost &
  SendMessageHost &
  ListActionsHost &
  QueryDomHost &
  DescribeVisibleHost &
  DescribeContextHost &
  ObserveHost

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
    const logEntry: LogEntry = {
      id: frame.id,
      at: Date.now(),
      kind,
      variant: extractVariant(frame.tool, frame.args),
      intent: buildIntent(frame.tool, frame.args, rpc.getMsgAnnotations()),
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
    close() {
      ws.close()
    },
  }
}

async function dispatch(tool: string, args: unknown, rpc: RpcHosts): Promise<unknown> {
  switch (tool) {
    case 'get_state':
      return handleGetState(rpc, (args ?? {}) as { path?: string })
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
    default:
      throw { code: 'invalid', detail: `unknown tool: ${tool}` }
  }
}

const READ_TOOLS = new Set([
  'get_state',
  'list_actions',
  'describe_context',
  'query_dom',
  'describe_visible_content',
  'observe',
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
  if (tool === 'list_actions') return 'List available actions'
  if (tool === 'describe_context') return 'Read current context'
  if (tool === 'describe_visible_content') return 'Read visible content'
  if (tool === 'query_dom') {
    const a = args as { name?: string } | null
    return a?.name ? `Query DOM: ${a.name}` : 'Query DOM'
  }
  return tool
}
