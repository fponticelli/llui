import type { AppHandle } from '@llui/dom'
import type { AgentEffect } from './effects.js'
import type { AgentConfirmState } from './agentConfirm.js'
import type { AgentDocs, AgentContext, MessageAnnotations, MessageSchemaEntry } from '../protocol.js'
import { attachWsClient, type WsLike, type RpcHosts } from './ws-client.js'
import { createEffectHandler } from './effect-handler.js'

type ComponentMetadata = {
  __msgSchema?: unknown
  __stateSchema?: unknown
  __msgAnnotations?: Record<string, MessageAnnotations>
  __bindingDescriptors?: Array<{ variant: string }>
  __schemaHash?: string
  name: string
  agentAffordances?: (state: unknown) => Array<{ type: string; [k: string]: unknown }>
  agentDocs?: AgentDocs
  agentContext?: (state: unknown) => AgentContext
}

export type CreateAgentClientOpts<State, Msg> = {
  handle: AppHandle
  def: ComponentMetadata
  appVersion?: string
  rootElement: Element | null
  slices: {
    getConnect: (s: State) => unknown
    getConfirm: (s: State) => AgentConfirmState
    wrapConnectMsg: (m: unknown) => Msg
    wrapConfirmMsg: (m: unknown) => Msg
  }
}

export type AgentClient = {
  effectHandler: (effect: AgentEffect) => Promise<void>
  start(): void
  stop(): void
}

export function createAgentClient<State, Msg>(
  opts: CreateAgentClientOpts<State, Msg>,
): AgentClient {
  let ws: WebSocket | null = null
  let wsClient: ReturnType<typeof attachWsClient> | null = null
  let confirmPollTimer: ReturnType<typeof setInterval> | null = null
  let stateSubscription: (() => void) | null = null
  const resolvedConfirms = new Set<string>()

  const rpcHost: RpcHosts = {
    getState: () => opts.handle.getState(),
    send: (m) => opts.handle.send(m),
    flush: () => opts.handle.flush(),
    getMsgAnnotations: () => opts.def.__msgAnnotations ?? null,
    getBindingDescriptors: () => opts.def.__bindingDescriptors ?? null,
    getAgentAffordances: () => opts.def.agentAffordances ?? null,
    getAgentContext: () => opts.def.agentContext ?? null,
    getRootElement: () => opts.rootElement,
    proposeConfirm: (entry) => {
      opts.handle.send(opts.slices.wrapConfirmMsg({ type: 'Propose', entry }))
    },
  }

  const helloBuilder = () => ({
    t: 'hello' as const,
    appName: opts.def.name,
    appVersion: opts.appVersion ?? '0.0.0',
    msgSchema: (opts.def.__msgSchema ?? {}) as Record<string, MessageSchemaEntry>,
    stateSchema: (opts.def.__stateSchema ?? {}) as object,
    affordancesSample: opts.def.agentAffordances ? opts.def.agentAffordances(opts.handle.getState()) : [],
    docs: opts.def.agentDocs ?? null,
    schemaHash: opts.def.__schemaHash ?? '',
  })

  const effectHandler = createEffectHandler({
    send: (m) => opts.handle.send(m),
    wrapAgentConnect: (m) => opts.slices.wrapConnectMsg(m),
    forward: (payload) => opts.handle.send(payload),
    openWs: (token, wsUrl) => {
      if (ws) ws.close()
      ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
      wsClient = attachWsClient(ws as unknown as WsLike, rpcHost, helloBuilder)
    },
    closeWs: () => {
      wsClient?.close()
      ws = null
      wsClient = null
    },
  })

  const pollConfirms = () => {
    const state = opts.handle.getState() as State
    const confirm = opts.slices.getConfirm(state)
    for (const entry of confirm.pending) {
      if (entry.status === 'pending') continue
      if (resolvedConfirms.has(entry.id)) continue
      resolvedConfirms.add(entry.id)
      if (entry.status === 'approved') {
        wsClient?.resolveConfirm(entry.id, 'confirmed', opts.handle.getState())
      } else if (entry.status === 'rejected') {
        wsClient?.resolveConfirm(entry.id, 'user-cancelled')
      }
    }
  }

  return {
    effectHandler,
    start() {
      if (!confirmPollTimer) confirmPollTimer = setInterval(pollConfirms, 200)
      if (!stateSubscription) {
        stateSubscription = opts.handle.subscribe((state) => {
          wsClient?.emitStateUpdate('/', state)
        })
      }
    },
    stop() {
      if (confirmPollTimer) clearInterval(confirmPollTimer)
      confirmPollTimer = null
      if (stateSubscription) { stateSubscription(); stateSubscription = null }
      wsClient?.close()
    },
  }
}
