import type { AppHandle } from '@llui/dom'
import type { AgentEffect } from './effects.js'
import type { AgentConfirmState } from './agentConfirm.js'
import type {
  AgentDocs,
  AgentContext,
  LapDrainMeta,
  MessageAnnotations,
  MessageSchemaEntry,
} from '../protocol.js'
import { attachWsClient, type WsLike, type RpcHosts } from './ws-client.js'
import { createEffectHandler } from './effect-handler.js'
import { makeDefaultCodecs, encodeForWire, decodeFromWire, type CodecRegistry } from '../codecs.js'

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
    /**
     * Optional: wrap an agentLog msg so the client-side activity feed
     * mirrors what Claude is doing. If omitted, outbound log-append
     * frames still go to the server, but the local agent.log slice
     * stays empty (the UI won't show activity).
     */
    wrapLogMsg?: (m: unknown) => Msg
  }
  /**
   * Codec registry for non-JSON-safe values (Date, Blob, Map, …)
   * crossing the LAP boundary. Defaults to `makeDefaultCodecs()`
   * which ships `iso-date` and `epoch-millis`. Provide a custom
   * registry to register additional codecs (e.g. `base64-blob` for
   * file uploads). See `@llui/agent/codecs` for the convention.
   */
  codecs?: CodecRegistry
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

  // Drain-error buffer: populated by persistent `window.error` and
  // `window.unhandledrejection` listeners installed on `start()`. The
  // send-message drain loop consumes and clears it per call so the
  // envelope surfaces only errors that fired during that window.
  const drainErrors: LapDrainMeta['errors'] = []
  let errorListenersInstalled = false
  let onErrorEvt: ((e: ErrorEvent) => void) | null = null
  let onRejectionEvt: ((e: PromiseRejectionEvent) => void) | null = null

  function installErrorListeners(): void {
    if (errorListenersInstalled) return
    if (typeof window === 'undefined') return
    onErrorEvt = (e: ErrorEvent) => {
      drainErrors.push({
        kind: 'error',
        message: e.message ?? String(e.error ?? 'unknown error'),
        stack: e.error instanceof Error ? e.error.stack : undefined,
      })
    }
    onRejectionEvt = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const message = r instanceof Error ? r.message : typeof r === 'string' ? r : safeStringify(r)
      drainErrors.push({
        kind: 'unhandledrejection',
        message,
        stack: r instanceof Error ? r.stack : undefined,
      })
    }
    window.addEventListener('error', onErrorEvt)
    window.addEventListener('unhandledrejection', onRejectionEvt)
    errorListenersInstalled = true
  }

  function removeErrorListeners(): void {
    if (!errorListenersInstalled) return
    if (typeof window === 'undefined') return
    if (onErrorEvt) window.removeEventListener('error', onErrorEvt)
    if (onRejectionEvt) window.removeEventListener('unhandledrejection', onRejectionEvt)
    onErrorEvt = null
    onRejectionEvt = null
    errorListenersInstalled = false
  }

  // Codec registry handles non-JSON-safe values (Date, etc.) crossing
  // the LAP boundary. `getState` encodes outgoing snapshots; `send`
  // decodes incoming agent messages before they hit the reducer. The
  // tagged-value convention is documented in `@llui/agent/codecs`.
  const codecs = opts.codecs ?? makeDefaultCodecs()

  const rpcHost: RpcHosts = {
    getState: () => encodeForWire(opts.handle.getState(), codecs),
    send: (m) => opts.handle.send(decodeFromWire(m, codecs)),
    flush: () => opts.handle.flush(),
    subscribe: (listener) => opts.handle.subscribe(() => listener()),
    getAndClearDrainErrors: () => drainErrors.splice(0, drainErrors.length),
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
    affordancesSample: opts.def.agentAffordances
      ? opts.def.agentAffordances(opts.handle.getState())
      : [],
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
      wsClient = attachWsClient(ws as unknown as WsLike, rpcHost, helloBuilder, {
        onActivated: () => {
          opts.handle.send(opts.slices.wrapConnectMsg({ type: 'ActivatedByClaude' }))
        },
        onLogEntry: opts.slices.wrapLogMsg
          ? (entry) => {
              opts.handle.send(opts.slices.wrapLogMsg!({ type: 'Append', entry }))
            }
          : undefined,
      })
      ws.addEventListener('open', () => {
        opts.handle.send(opts.slices.wrapConnectMsg({ type: 'WsOpened' }))
      })
      ws.addEventListener('close', () => {
        opts.handle.send(opts.slices.wrapConnectMsg({ type: 'WsClosed' }))
      })
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
        wsClient?.resolveConfirm(
          entry.id,
          'confirmed',
          encodeForWire(opts.handle.getState(), codecs),
        )
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
          // Same codec convention as `getState`: outgoing snapshots
          // pass through the encoder so non-JSON-safe values (Date,
          // etc.) become tagged-wire form.
          wsClient?.emitStateUpdate('/', encodeForWire(state, codecs))
        })
      }
      installErrorListeners()
    },
    stop() {
      if (confirmPollTimer) clearInterval(confirmPollTimer)
      confirmPollTimer = null
      if (stateSubscription) {
        stateSubscription()
        stateSubscription = null
      }
      removeErrorListeners()
      drainErrors.length = 0
      wsClient?.close()
    },
  }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
