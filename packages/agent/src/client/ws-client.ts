import type { ClientFrame, ServerFrame, HelloFrame, LogEntry, LogKind } from '../protocol.js'
import { handleGetState, type GetStateHost } from './rpc/get-state.js'
import { handleSendMessage, type SendMessageHost } from './rpc/send-message.js'
import { handleListActions, type ListActionsHost } from './rpc/list-actions.js'
import { handleQueryDom, type QueryDomHost } from './rpc/query-dom.js'
import { handleDescribeVisibleContent, type DescribeVisibleHost } from './rpc/describe-visible-content.js'
import { handleDescribeContext, type DescribeContextHost } from './rpc/describe-context.js'

export interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(event: 'message', h: (e: { data: string | ArrayBuffer }) => void): void
  addEventListener(event: 'open' | 'close', h: () => void): void
}

export type RpcHosts = GetStateHost & SendMessageHost & ListActionsHost & QueryDomHost & DescribeVisibleHost & DescribeContextHost

export type HelloBuilder = () => HelloFrame

export type WsClient = {
  /** Resolve a pending confirmation; emits confirm-resolved frame to the server. */
  resolveConfirm(confirmId: string, outcome: 'confirmed' | 'user-cancelled', stateAfter?: unknown): void
  /** Emit a state-update frame so the server can resolve waitForChange promises. */
  emitStateUpdate(path: string, stateAfter: unknown): void
  /** Emit a log-append frame so the server can mirror client-observed actions to the audit sink. */
  emitLogAppend(entry: LogEntry): void
  /** Close the socket cleanly. */
  close(): void
}

/**
 * Wires up a WebSocket to serve rpc requests from the server. See spec §9.4.
 */
export function attachWsClient(ws: WsLike, rpc: RpcHosts, hello: HelloBuilder): WsClient {
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
    if (frame.t !== 'rpc') return
    let result: unknown
    let rpcErr: { code?: string; detail?: string } | null = null
    try {
      result = await dispatch(frame.tool, frame.args, rpc)
      const reply: ClientFrame = { t: 'rpc-reply', id: frame.id, result }
      ws.send(JSON.stringify(reply))
    } catch (e: unknown) {
      rpcErr = e as { code?: string; detail?: string }
      const errFrame: ClientFrame = {
        t: 'rpc-error', id: frame.id,
        code: rpcErr.code ?? 'internal',
        detail: rpcErr.detail,
      }
      ws.send(JSON.stringify(errFrame))
    }
    const kind = getLogKindForTool(frame.tool, result, rpcErr)
    const logEntry: LogEntry = {
      id: frame.id,
      at: Date.now(),
      kind,
      variant: extractVariant(frame.tool, frame.args),
      intent: undefined,
    }
    ws.send(JSON.stringify({ t: 'log-append', entry: logEntry } satisfies ClientFrame))
  })

  return {
    resolveConfirm(confirmId, outcome, stateAfter) {
      const frame: ClientFrame = {
        t: 'confirm-resolved', confirmId, outcome, stateAfter,
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
    case 'get_state': return handleGetState(rpc, (args ?? {}) as { path?: string })
    case 'list_actions': return handleListActions(rpc)
    case 'send_message': return handleSendMessage(rpc, args as never)
    case 'query_dom': return handleQueryDom(rpc, args as never)
    case 'describe_visible_content': return handleDescribeVisibleContent(rpc)
    case 'describe_context': return handleDescribeContext(rpc)
    default: throw { code: 'invalid', detail: `unknown tool: ${tool}` }
  }
}

const READ_TOOLS = new Set(['get_state', 'list_actions', 'describe_context', 'query_dom', 'describe_visible_content'])

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
