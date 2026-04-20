import type { ClientFrame, ServerFrame, HelloFrame } from '../protocol.js'
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
    try {
      const result = await dispatch(frame.tool, frame.args, rpc)
      const reply: ClientFrame = { t: 'rpc-reply', id: frame.id, result }
      ws.send(JSON.stringify(reply))
    } catch (e: unknown) {
      const err = e as { code?: string; detail?: string }
      const errFrame: ClientFrame = {
        t: 'rpc-error', id: frame.id,
        code: err.code ?? 'internal',
        detail: err.detail,
      }
      ws.send(JSON.stringify(errFrame))
    }
  })

  return {
    resolveConfirm(confirmId, outcome, stateAfter) {
      const frame: ClientFrame = {
        t: 'confirm-resolved', confirmId, outcome, stateAfter,
      }
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
