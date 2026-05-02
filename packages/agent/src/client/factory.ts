import type { AppHandle } from '@llui/dom'
import type { AgentEffect } from './effects.js'
import type { AgentConfirmState } from './agentConfirm.js'
import type {
  AgentDocs,
  AgentContext,
  AgentToken,
  LapDrainMeta,
  MessageAnnotations,
  MessageSchemaEntry,
} from '../protocol.js'
import { attachWsClient, type WsLike, type RpcHosts } from './ws-client.js'
import { createEffectHandler } from './effect-handler.js'
import { makeDefaultCodecs, encodeForWire, decodeFromWire, type CodecRegistry } from '../codecs.js'

/**
 * The shape the compiler emits as `__msgSchema`. Mirrors `MsgField`
 * from `@llui/vite-plugin/src/msg-schema.ts`. Three coexisting forms:
 *
 *   1. Bare primitive: `'string' | 'number' | 'boolean' | 'unknown'`
 *      and bare enum: `{enum: [...]}` (values may be string, number,
 *      or boolean — the compiler preserves the literal kind so JSON
 *      round-trips don't lose type info).
 *   2. Bare nested types: `{kind: 'object', shape}` for inline /
 *      followed-via-typeIndex shapes; `{kind: 'array', element}` for
 *      `T[]` / `readonly T[]` / `Array<T>`; `{kind: 'discriminated-
 *      union', discriminant, variants}` for tagged unions of objects
 *      (e.g. `Format = {kind:'exact'} | {kind:'range', min, max}`).
 *      The synthesizer recurses to build copy-paste-ready nested
 *      examples; the validator walks the same tree.
 *   3. Rich descriptor: wraps any of the above with `{optional?,
 *      priority?, hint?}` carrying TS optionality and `@should` hints.
 */
export type MsgSchemaBareType =
  | string
  | { enum: ReadonlyArray<string | number | boolean> }
  | { kind: 'object'; shape: Record<string, MsgSchemaField> }
  | { kind: 'array'; element: MsgSchemaBareType }
  | {
      kind: 'discriminated-union'
      discriminant: string
      variants: Record<string, Record<string, MsgSchemaField>>
    }

export type MsgSchemaField =
  | MsgSchemaBareType
  | {
      type: MsgSchemaBareType
      optional?: boolean
      priority?: 'should'
      hint?: string
      /**
       * Boolean JS expression authored with `@validates("expr")` JSDoc.
       * Has `v` bound to the field value at runtime; the validator
       * compiles it lazily with `new Function('v', 'return (' + src +
       * ')')` and caches the function across calls. Use for invariants
       * the type system can't express — numeric ranges, format
       * predicates, length bounds.
       */
      validates?: string
    }

export type MsgSchemaShape = {
  discriminant: string
  variants: Record<string, Record<string, MsgSchemaField>>
}

type ComponentMetadata = {
  __msgSchema?: unknown
  __stateSchema?: unknown
  __msgAnnotations?: Record<string, MessageAnnotations>
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
    /**
     * Optional: wrap an agentAttention msg so the visual-attention
     * slice can clear its spotlight on the auto-clear timer. Hosts
     * that wire `agentAttention` should set this; hosts that don't
     * leave it unset and the spotlight (which they aren't rendering)
     * never matters. The factory uses it for the reverse direction
     * too: `onLogEntry` re-dispatches the same `Append { entry }`
     * payload into the attention slice when wired, so a single
     * incoming `log-append` frame fans out to both slices without
     * the host needing to write the routing.
     */
    wrapAttentionMsg?: (m: unknown) => Msg
  }
  /**
   * Codec registry for non-JSON-safe values (Date, Blob, Map, …)
   * crossing the LAP boundary. Defaults to `makeDefaultCodecs()`
   * which ships `iso-date` and `epoch-millis`. Provide a custom
   * registry to register additional codecs (e.g. `base64-blob` for
   * file uploads). See `@llui/agent/codecs` for the convention.
   */
  codecs?: CodecRegistry
  /**
   * Base path for agent HTTP endpoints. Default: `'/agent'` (matches
   * the canonical paths in `@llui/vite-plugin`'s dev middleware and
   * `@llui/agent/server`). The mint URL, resume URLs, and revoke URL
   * derive from this so consumers don't have to keep them in sync.
   *
   * Override when:
   *   - **Cross-origin agent server**: pass the full base, e.g.
   *     `'https://api.example.com/agent'` or `'http://localhost:8787/agent'`.
   *   - **`@cloudflare/vite-plugin` in dev**: pass `'/cdn-cgi/agent'`
   *     because cloudflare-vite shadows non-`/cdn-cgi/*` routes.
   */
  agentBasePath?: string
  /**
   * Storage adapter for the active session blob. When provided the
   * framework owns the persist/restore loop end-to-end: writes on
   * `MintSucceeded`, reads on `start()` (auto-dispatching
   * `RestoreSession` when a non-expired blob is found), clears on
   * `Disconnect` / `Revoke` / explicit clear effects.
   *
   * Default: `defaultSessionStorage()` — uses `window.sessionStorage`
   * under the key `'llui-agent:session'`. Tab-scoped (survives
   * refresh, dies on tab close), which matches how a single-tab
   * agent connection should behave.
   *
   * Pass `null` to opt out entirely; the framework then emits the
   * `AgentSessionPersist` / `AgentSessionClear` effects unchanged
   * and the host owns storage. Useful for SSR builds where
   * `sessionStorage` is undefined and the host wants to no-op the
   * storage layer.
   *
   * Pass a custom adapter for tests, IndexedDB-backed apps, or
   * environments where `sessionStorage` is unavailable but the
   * persistence semantics are still wanted (e.g. Web Workers).
   */
  sessionStorage?: AgentSessionStorage | null
}

/**
 * Tab-lifetime persistence for the active agent session. Reads /
 * writes a single blob; the framework synchronizes it with the
 * connect lifecycle so refresh-survival is automatic. Implementations
 * must be synchronous on the read path so `start()` can decide
 * whether to dispatch `RestoreSession` before any UI mounts —
 * otherwise the `idle`-only guard in the reducer might miss the
 * restore when a `Mint` click races the async lookup.
 */
export type AgentSessionStorage = {
  read(): PersistedAgentSession | null
  write(session: PersistedAgentSession): void
  clear(): void
}

export type PersistedAgentSession = {
  token: AgentToken
  tid: string
  lapUrl: string
  wsUrl: string
  expiresAt: number
}

/**
 * The default `AgentSessionStorage` — wraps `window.sessionStorage`
 * under a single key and treats parse / type-mismatch failures as
 * "no session". Returns `null` from the factory when `window` is
 * undefined (SSR/tests), so calling code never has to feature-detect
 * the browser environment itself.
 */
export function defaultSessionStorage(
  storageKey: string = 'llui-agent:session',
): AgentSessionStorage | null {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return null
  const ss = window.sessionStorage
  return {
    read: () => {
      let raw: string | null
      try {
        raw = ss.getItem(storageKey)
      } catch {
        return null
      }
      if (raw === null || raw === '') return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        try {
          ss.removeItem(storageKey)
        } catch {
          /* ignore */
        }
        return null
      }
      if (!parsed || typeof parsed !== 'object') return null
      const o = parsed as Record<string, unknown>
      if (
        typeof o.token !== 'string' ||
        typeof o.tid !== 'string' ||
        typeof o.lapUrl !== 'string' ||
        typeof o.wsUrl !== 'string' ||
        typeof o.expiresAt !== 'number'
      ) {
        return null
      }
      // `expiresAt` is unix-seconds (server's mint endpoint floors
      // ms→s). Compare to `Date.now() / 1000` so the same-units
      // footgun the host code hit doesn't bite the framework too.
      if (o.expiresAt * 1000 <= Date.now()) return null
      return {
        token: o.token as AgentToken,
        tid: o.tid,
        lapUrl: o.lapUrl,
        wsUrl: o.wsUrl,
        expiresAt: o.expiresAt,
      }
    },
    write: (session) => {
      try {
        ss.setItem(storageKey, JSON.stringify(session))
      } catch {
        /* private mode / quota — non-fatal */
      }
    },
    clear: () => {
      try {
        ss.removeItem(storageKey)
      } catch {
        /* ignore */
      }
    },
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

  // Track the most recent send_message outcome so `describe_context`
  // can prepend a synthetic hint about it. Apps used to roll their
  // own `lastDispatchError` state field; the framework now owns it.
  let lastDispatchOutcome: import('./rpc/describe-context.js').LastDispatchOutcome | null = null

  const rpcHost: RpcHosts = {
    getState: () => encodeForWire(opts.handle.getState(), codecs),
    send: (m) => opts.handle.send(decodeFromWire(m, codecs)),
    flush: () => opts.handle.flush(),
    subscribe: (listener) => opts.handle.subscribe(() => listener()),
    getAndClearDrainErrors: () => drainErrors.splice(0, drainErrors.length),
    getMsgAnnotations: () => opts.def.__msgAnnotations ?? null,
    // The compiler-injected message schema. Used by `list_actions` to
    // synthesize payload examples for `@agentOnly` variants that have
    // no live UI binding — the agent should still see them as
    // affordances even though no human can click them.
    getMsgSchema: () => (opts.def.__msgSchema as MsgSchemaShape | undefined) ?? null,
    // Run the reducer in isolation for `would_dispatch`. Wraps the
    // AppHandle's same-named method so the host doesn't need a direct
    // reference to the live ComponentInstance.
    runReducer: (msg) => opts.handle.runReducer(msg),
    // Live binding descriptors: read from the runtime registry that
    // tracks which Msg variants are dispatchable from currently-mounted
    // event handlers. Empty array when the app wasn't compiled with
    // agent metadata (no tagger pass) or has no view bindings yet —
    // both produce the same "no live affordances" signal at the agent
    // layer.
    getBindingDescriptors: () => opts.handle.getBindingDescriptors(),
    getAgentAffordances: () => opts.def.agentAffordances ?? null,
    getAgentContext: () => opts.def.agentContext ?? null,
    getLastDispatchOutcome: () => lastDispatchOutcome,
    getRootElement: () => opts.rootElement,
    proposeConfirm: (entry) => {
      opts.handle.send(opts.slices.wrapConfirmMsg({ type: 'Propose', entry }))
    },
  }

  // Exposed so the WS client can update on each send_message reply.
  // Closure scope keeps the field write-protected — only the WS layer
  // mutates it; everyone else reads through the getter above.
  const recordDispatchOutcome = (outcome: typeof lastDispatchOutcome): void => {
    lastDispatchOutcome = outcome
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

  // Storage adapter: opt-out with `null`, custom adapter, or default
  // to `sessionStorage` under the canonical key. The framework
  // synchronizes it with the connect lifecycle so refresh-survival
  // is automatic for any host that doesn't explicitly disable it.
  const sessionStorage =
    opts.sessionStorage === null
      ? null
      : opts.sessionStorage !== undefined
        ? opts.sessionStorage
        : defaultSessionStorage()

  const effectHandler = createEffectHandler({
    send: (m) => opts.handle.send(m),
    wrapAgentConnect: (m) => opts.slices.wrapConnectMsg(m),
    wrapAgentAttention: opts.slices.wrapAttentionMsg
      ? (m) => opts.slices.wrapAttentionMsg!(m)
      : undefined,
    forward: (payload) => opts.handle.send(payload),
    agentBasePath: opts.agentBasePath,
    sessionStorage,
    openWs: (token, wsUrl) => {
      if (ws) ws.close()
      ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
      wsClient = attachWsClient(ws as unknown as WsLike, rpcHost, helloBuilder, {
        onActivated: () => {
          opts.handle.send(opts.slices.wrapConnectMsg({ type: 'ActivatedByClaude' }))
        },
        onLogEntry:
          opts.slices.wrapLogMsg || opts.slices.wrapAttentionMsg
            ? (entry) => {
                if (opts.slices.wrapLogMsg) {
                  opts.handle.send(opts.slices.wrapLogMsg({ type: 'Append', entry }))
                }
                if (opts.slices.wrapAttentionMsg) {
                  // Same `Append { entry }` shape — both slices accept
                  // it and decide independently whether to act
                  // (agentAttention only acts on `kind: 'dispatched'`).
                  opts.handle.send(opts.slices.wrapAttentionMsg({ type: 'Append', entry }))
                }
              }
            : undefined,
        onDispatchOutcome: recordDispatchOutcome,
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
      // Auto-restore from storage. If a non-expired session blob is
      // present, dispatch RestoreSession synchronously so the connect
      // flow re-enters `pending-claude` before any UI mounts. The
      // reducer's `idle`-only guard means a host that ALSO dispatches
      // its own RestoreSession (legacy hosts that wired storage
      // themselves) won't double-fire — the second call is a no-op.
      if (sessionStorage) {
        const persisted = sessionStorage.read()
        if (persisted) {
          opts.handle.send(
            opts.slices.wrapConnectMsg({
              type: 'RestoreSession',
              token: persisted.token,
              tid: persisted.tid,
              lapUrl: persisted.lapUrl,
              wsUrl: persisted.wsUrl,
              expiresAt: persisted.expiresAt,
            }),
          )
        }
      }
      installErrorListeners()
      // Catch per-binding throws into drain.errors so a single bad
      // binding doesn't blank the page AND the agent learns about it.
      // Runtime contract: leaves the binding's `lastValue` unchanged
      // (DOM stays at last-rendered value), continues with siblings,
      // calls this hook once per binding throw.
      opts.handle.setOnBindingError((info) => {
        drainErrors.push({
          kind: 'error',
          message: `[binding ${info.kind}${info.key ? `:${info.key}` : ''}] ${info.message}`,
          stack: info.stack,
        })
      })
    },
    stop() {
      if (confirmPollTimer) clearInterval(confirmPollTimer)
      confirmPollTimer = null
      if (stateSubscription) {
        stateSubscription()
        stateSubscription = null
      }
      removeErrorListeners()
      opts.handle.setOnBindingError(null)
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
