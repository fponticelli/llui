import type { SignalComponentHandle } from '@llui/dom'
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
import { LAP_VERSION } from '../protocol.js'
import { attachWsClient, type WsLike, type RpcHosts } from './ws-client.js'
import { createEffectHandler } from './effect-handler.js'
import { makeDefaultCodecs, encodeForWire, decodeFromWire, type CodecRegistry } from '../codecs.js'
import { resolvePath } from './rpc/query-state.js'
import { computeStateDiff } from '../state-diff.js'

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
  handle: SignalComponentHandle<State, unknown>
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
   * Redaction hook applied to app state **at the source**, before any
   * snapshot leaves the browser for the agent/LLM. Runs on every
   * wire-bound read — `get_state`/`observe`/`query_state`, the
   * per-change `state-update` broadcast, and confirm-resolution
   * snapshots — so a secret omitted here never transits the WS, the
   * server, or the model. Return a redacted COPY (do not mutate the
   * input); the reducer/app keep the real state. Omit fields, mask
   * values, or return `{}` to withhold state entirely. This is the
   * only place that can use the app's own knowledge of which fields
   * are sensitive — prefer it over any downstream/server-side filter.
   */
  redactState?: (state: State) => State
  /**
   * Payload-validation policy for agent `send_message` dispatches.
   * `'strict'` rejects payload fields not in the compiled schema and
   * warns on `'unknown'`-typed fields the agent supplied a value for;
   * `'lenient'` (default) accepts extras silently. Wired through to the
   * per-dispatch validator so strict mode is usable in production, not
   * only in tests.
   */
  dispatchPolicy?: 'strict' | 'lenient'
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
  let stateSubscription: (() => void) | null = null
  const resolvedConfirms = new Set<string>()

  // Monotonic socket generation: each `openWs` bumps it and tags its
  // socket. Close/open events from a superseded socket (which we closed
  // ourselves during a reconnect) carry a stale generation and are
  // ignored — otherwise closing the old socket would dispatch a spurious
  // `WsClosed` and kick off a phantom reconnect (finding: second-WS
  // spurious reconnect).
  let wsGeneration = 0

  // Active server-armed state watches (finding: subscription-driven
  // state-watch). Empty ⇒ zero per-commit work. Each entry remembers the
  // last resolved value under its pointer so we only emit a state-update
  // when that value actually changes.
  type Watch = { path: string | undefined; last: unknown }
  const watches = new Map<string, Watch>()

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

  // Single seam for state leaving the app toward the agent. `redactedState`
  // applies the app's own `redactState` at the source. Every outbound
  // surface — wire reads, the state-update broadcast, and the hello-frame
  // affordances sample — goes through this, so none can leak a redacted
  // field. Codec (wire) encoding is applied separately, at the frame
  // boundary (`encodeWire` in attachWsClient), so app callbacks see raw
  // values.
  const redactedState = (state: unknown): unknown =>
    opts.redactState ? opts.redactState(state as State) : state

  // Resolve a watch's pointer against a state snapshot. `undefined` / `''`
  // ⇒ the whole state. Change-DETECTION runs on the RAW (unredacted)
  // state so a genuine change still resolves a `/wait` even when the
  // app's `redactState` happens to mask that particular delta; the
  // EMITTED snapshot is redacted separately (see emitWatchUpdates).
  const resolveWatchValue = (state: unknown, path: string | undefined): unknown => {
    if (path === undefined || path === '') return state
    const r = resolvePath(state, path)
    return r.found ? r.value : undefined
  }

  const rpcHost: RpcHosts = {
    // Raw, redacted-but-UNENCODED state. Every app callback (agentAffordances,
    // agentContext, @routeGated predicates) and JSON-pointer resolution runs
    // on this — so a predicate touching a Date field sees a real Date, not
    // its wire-tagged form. Codec encoding happens once, at the frame
    // boundary (see `encodeWire` passed to attachWsClient). Returning the
    // raw reference (no per-call clone) also lets `computeStateDiff` prune
    // unchanged subtrees via `Object.is` on the send_message path.
    getState: () => redactedState(opts.handle.getState()),
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
    // Payload-validation policy. Wired from the factory option so strict
    // mode (reject unknown fields, warn on `'unknown'`-typed fields the
    // agent supplied) is reachable in production, not just tests. Default
    // lenient.
    getDispatchPolicy: () => opts.dispatchPolicy ?? 'lenient',
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
      ? opts.def.agentAffordances(redactedState(opts.handle.getState()))
      : [],
    docs: opts.def.agentDocs ?? null,
    schemaHash: opts.def.__schemaHash ?? '',
    lapVersion: LAP_VERSION,
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
      // Bump the generation BEFORE closing the old socket, so the close
      // event the `ws.close()` below triggers is already stale (myGen of
      // the old listener !== wsGeneration) and is ignored.
      const myGen = ++wsGeneration
      if (ws) ws.close()
      // Re-pairing to a new socket: drop stale watch baselines so the next
      // /wait re-arms cleanly.
      watches.clear()
      ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
      wsClient = attachWsClient(ws as unknown as WsLike, rpcHost, helloBuilder, {
        encodeWire: (v) => encodeForWire(v, codecs),
        onWatch: (id, path) => {
          // Baseline against the RAW state, in wire-encoded form so the
          // change detector can tell two Dates (etc.) apart — computeStateDiff
          // sees a bare Date as a keyless object and would miss the change.
          watches.set(id, {
            path,
            last: encodeForWire(resolveWatchValue(opts.handle.getState(), path), codecs),
          })
        },
        onUnwatch: (id) => {
          watches.delete(id)
        },
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
        onConfirmExpire: (confirmId) => {
          // The server abandoned this confirm (told the agent it was
          // rejected). Reject the local entry so a late Approve can't
          // fire the dispatch. `Reject` is a no-op if already resolved,
          // and marks a still-pending entry terminally rejected.
          resolvedConfirms.add(confirmId)
          opts.handle.send(opts.slices.wrapConfirmMsg({ type: 'Reject', id: confirmId }))
        },
      })
      ws.addEventListener('open', () => {
        if (myGen !== wsGeneration) return // superseded socket
        opts.handle.send(opts.slices.wrapConnectMsg({ type: 'WsOpened' }))
      })
      ws.addEventListener('close', () => {
        // Ignore the close of a socket we already superseded — otherwise
        // the deliberate `ws.close()` above would dispatch WsClosed and
        // trigger a phantom reconnect against the live socket.
        if (myGen !== wsGeneration) return
        opts.handle.send(opts.slices.wrapConnectMsg({ type: 'WsClosed' }))
      })
    },
    closeWs: () => {
      wsClient?.close()
      ws = null
      wsClient = null
    },
  })

  // Confirm-resolution detection, folded into the state subscription
  // (finding: delete the 200ms poll). Every confirm resolution is itself
  // a state-changing dispatch (Approve/Reject), so the subscription fires
  // exactly when there's something to detect. Resolved ids are tracked to
  // avoid double-emitting, and pruned once their entry leaves `pending`
  // so the set can't grow unbounded across a long session.
  const detectConfirms = (state: State): void => {
    const confirm = opts.slices.getConfirm(state)
    for (const entry of confirm.pending) {
      if (entry.status === 'pending') continue
      if (resolvedConfirms.has(entry.id)) continue
      resolvedConfirms.add(entry.id)
      if (entry.status === 'approved') {
        // Raw redacted state; encoded at the wire boundary.
        wsClient?.resolveConfirm(entry.id, 'confirmed', redactedState(opts.handle.getState()))
      } else if (entry.status === 'rejected') {
        wsClient?.resolveConfirm(entry.id, 'user-cancelled')
      }
    }
    // Prune ids whose entry is no longer present (GC'd / expired), so the
    // bookkeeping set stays bounded.
    if (resolvedConfirms.size > 0) {
      const liveIds = new Set(confirm.pending.map((e) => e.id))
      for (const id of resolvedConfirms) if (!liveIds.has(id)) resolvedConfirms.delete(id)
    }
  }

  // Emit state-update frames only for currently-armed server watches
  // (finding: subscription-driven). Idle session (no watch) ⇒ no work.
  const emitWatchUpdates = (state: unknown): void => {
    if (watches.size === 0) return
    let redacted: unknown
    let haveRedacted = false
    for (const [id, w] of watches) {
      // Compare on the wire-encoded resolved value (see onWatch): a
      // zero-length diff means nothing the agent watches actually changed.
      const cur = encodeForWire(resolveWatchValue(state, w.path), codecs)
      if (computeStateDiff(w.last, cur).length === 0) continue
      w.last = cur
      // Emit the REDACTED whole-state snapshot as `stateAfter` (encoded at
      // the wire boundary). Redact once per commit, lazily.
      if (!haveRedacted) {
        redacted = redactedState(state)
        haveRedacted = true
      }
      wsClient?.emitStateUpdate(id, w.path ?? '', redacted)
    }
  }

  return {
    effectHandler,
    start() {
      if (!stateSubscription) {
        stateSubscription = opts.handle.subscribe(() => {
          const state = opts.handle.getState() as State
          detectConfirms(state)
          emitWatchUpdates(state)
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
      if (stateSubscription) {
        stateSubscription()
        stateSubscription = null
      }
      watches.clear()
      resolvedConfirms.clear()
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
