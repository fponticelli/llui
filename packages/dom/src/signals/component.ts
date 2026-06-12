// Signal component lifecycle — the TEA loop for signal-compiled components.
//
// State is plain data; `view` builds DOM once via the signal helpers; `send`
// runs the pure reducer, feeds the new state to the chunked-mask reconciler
// (which re-runs only bindings whose dependency paths changed), then dispatches
// returned effects to `onEffect`.
//
// The view bag carries a `state` HANDLE — `.peek()` / `.at(path).peek()` read the
// CURRENT state. Reactive slots are compiled to bindings that don't touch this
// handle; only event handlers / effects use it (the `state.at('x').peek()` form
// is left verbatim by the transform and satisfied here at runtime).

import { mountSignal, type SignalMount, type MountTarget, type Renderable } from './dom.js'
import { withBindingErrors, type BindingError } from './runtime.js'
import { pathHandle } from './handle.js'
import { installSignalDebug, type SignalMessageRecord } from './devtools.js'
import type { Signal } from './types.js'

// Vite/Rollup substitute `import.meta.env.DEV` at build time; bundlers
// without the substitution (raw tsc / vitest) see it as undefined, so
// the dev path stays off. The augmentation is declared here (rather than
// pulling in `vite/client`) so `@llui/dom` carries no build-tool dep.
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

/** The bag's `state` is a `Signal<S>` so authored handler code reads it the same
 * way as the view (`state.at('x').peek()`). At runtime it's a read handle: `.at`
 * narrows, `.peek` reads the current value; `.map` is a view-build-time concept
 * and throws if reached on the handle. */
export type StateHandle<S> = Signal<S>

function makeHandle<S>(get: () => unknown, base = ''): Signal<S> {
  // Runtime realization of the Signal surface — carries produce+deps so it can
  // be passed to view helpers (which build bindings from it at runtime).
  return pathHandle<S>(get, base)
}

export interface ComponentBag<S, M> {
  state: Signal<S>
  send: (msg: M) => void
  /** Coalesce a burst of `send`s into ONE reconcile (see the handle's `batch`).
   * Reducers/effects still run per message; only the DOM commit is deferred to the
   * outermost `batch` exit. Use it to drain a burst of dispatches (e.g. a stream
   * frame) from a handler/subscription as a single re-render. */
  batch: (fn: () => void) => void
}

export interface EffectApi<S, M> {
  send: (msg: M) => void
  state: Signal<S>
  /** Coalesce a burst of `send`s into ONE reconcile (see {@link ComponentBag.batch}). */
  batch: (fn: () => void) => void
}

export interface SignalComponentDef<S, M, E = never> {
  /** optional component name (for the debug registry / agent identity) */
  readonly name?: string
  /** initial state, optionally with initial effects */
  init: () => S | [S, E[]]
  /** pure reducer; returns the next state, optionally with effects. A bare `S`
   * (non-tuple) return is accepted for convenience. */
  update: (state: S, msg: M) => [S, E[]] | S
  /** build the view once; reactive reads are signal bindings (they don't close
   * over `state`). The bag's `state` handle is for handlers/effects. */
  view: (bag: ComponentBag<S, M>) => Renderable
  /** handle an effect; may return a cleanup function */
  onEffect?: (effect: E, api: EffectApi<S, M>) => void | (() => void)

  // ── Compiler-injected introspection metadata (see @llui/compiler signals
  // transform). Optional — present only in dev / agent builds. Read by the
  // agent-client pairing path and the (signal) debug surface. ──
  /** discriminated-union schema of Msg ({ discriminant, variants }) */
  readonly __msgSchema?: object
  /** discriminated-union schema of Effect */
  readonly __effectSchema?: object
  /** state shape schema */
  readonly __stateSchema?: object
  /** per-message JSDoc annotations (intent, affordability, …) */
  readonly __msgAnnotations?: Record<string, unknown>
  /** stable hash of the schemas, for hot-reload schema-change detection */
  readonly __schemaHash?: string
  /** dev-only source location */
  readonly __componentMeta?: { file: string; line: number }
}

export interface SignalComponentHandle<S, M> {
  send(msg: M): void
  /** Coalesce a burst of `send`s into ONE reconcile + commit. Every message's
   * reducer still runs in order (state advances message-by-message, effects fire
   * per message), but the DOM reconcile + subscriber notification are deferred to
   * a single pass against the FINAL state when the outermost `batch` returns.
   * For N synchronous sends this turns N reconciles into 1 — the streaming /
   * bulk-dispatch fast path (e.g. draining a websocket frame of ticks). State is
   * applied by the time `batch` returns, so the synchronous-`send` contract holds
   * at the batch boundary. Nested `batch` calls flush only at the outermost exit. */
  batch(fn: () => void): void
  getState(): S
  /** no-op: signal `send` applies updates synchronously (kept for harness/agent
   * parity with the legacy handle). */
  flush(): void
  /** run all pending effect cleanups (subscriptions etc.) */
  dispose(): void
  /** Register a listener called synchronously after every update cycle that
   * changes state, with the new state. Returns an unsubscribe. No-op after
   * dispose. Backs the agent protocol's state-update frames. */
  subscribe(listener: (state: S) => void): () => void
  /** Run the reducer in isolation against the current state — `{state, effects}`
   * with no commit/flush/effect dispatch. Backs the agent's `would_dispatch`. */
  runReducer(msg: M): { state: S; effects: unknown[] } | null
  /** Snapshot the Msg variants dispatchable from currently-rendered UI (live
   * `tagSend` registrations). Backs the agent's `list_actions`. */
  getBindingDescriptors(): Array<{ variant: string }>
  /** Hot-swap the reducer (and optionally onEffect) without rebuilding the DOM —
   * the HMR escape hatch for pure update.ts edits. State-type erased at this
   * boundary (`unknown`) so the handle stays assignable across state types. */
  swapUpdate(
    newUpdate: (state: unknown, msg: unknown) => [unknown, unknown[]] | unknown,
    newOnEffect?: unknown,
  ): void
  /** Install a hook called when a binding accessor throws during the update
   * cycle; the runtime leaves the binding's DOM at its prior value and continues
   * with siblings. Backs the agent's dispatch-envelope `drain.errors`. */
  setOnBindingError(hook: ((e: BindingError) => void) | null): void
}

function normalize<S, E>(r: [S, E[]] | S): [S, E[]] {
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [S, E[]])[1])) {
    return r as [S, E[]]
  }
  return [r as S, []]
}

/** Options for `mountSignalComponent`. */
export interface MountSignalOptions<S> {
  /** Hydrate over server-rendered DOM instead of a fresh mount: seed the loop
   * with `serverState` (what the server rendered with) and atomically REPLACE the
   * server HTML with the freshly-built client tree. init()'s effects are skipped
   * by default (the server pass already ran them) — opt back in with
   * `runInitEffects` for init()s gated to no-op on the server. */
  hydrate?: { serverState: S; runInitEffects?: boolean }
  /** Seed state to mount with instead of `init()`'s result (adapters that derive
   * the seed externally, e.g. per-route data). init() still runs so its effects
   * are captured; only the returned state is overridden. Ignored when hydrating
   * (use `hydrate.serverState` there). */
  initialState?: S
  /** Context values to expose at the root of this build (see `runBuild`'s
   * `seedContexts`). `@llui/vike` replays a layout's in-scope contexts here so a
   * nested page reads providers that live above its slot in a SEPARATE build. */
  contexts?: ReadonlyMap<symbol, unknown>
  /** Commit scheduling. `'sync'` (the default) commits the DOM + notifies
   * subscribers inside every top-level `send` — the synchronous contract.
   * `'raf'` is the OPT-IN streaming/burst fast path: reducers and effects
   * still run synchronously per send (state and `getState()` advance
   * immediately — the data contract holds), but the DOM commit + subscriber
   * notification coalesce to ONE reconcile per animation frame (microtask
   * fallback where rAF doesn't exist: SSR, plain jsdom, the headless agent).
   * The DOM therefore lags state by up to a frame; `handle.flush()` forces
   * the pending commit synchronously (tests, the agent protocol, a
   * read-after-write). Measured on the ticker suite's 1k-send burst:
   * 14.1ms per-send vs 5.9ms coalesced (hand-written-vanilla parity). */
  scheduler?: 'sync' | 'raf'
  /** Register this component in the global devtools registry
   * (`__lluiComponents` / `__lluiDebug`). Default `true` in dev. Set `false`
   * for self-introspecting dev tooling (e.g. an in-app debug HUD authored with
   * LLui) so it doesn't pollute the host app's component list that external
   * tools — the MCP server, agent bridge, debug-collector — read. */
  devtools?: boolean
}

/** Mount a signal component and drive its update loop. The target is a container
 * `Element` (fresh mount appends; hydration replaces) OR a `MountTarget`
 * descriptor — including `{ anchor }` for adapters mounting a nested layer as
 * siblings of a slot anchor. With `opts.hydrate`, takes over server-rendered
 * HTML (see MountSignalOptions). */
export function mountSignalComponent<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  opts?: MountSignalOptions<S>,
): SignalComponentHandle<S, M> {
  // init() runs either way so its effects are captured; on hydrate the returned
  // state is discarded in favour of serverState.
  const [seedState, initialEffects] = normalize<S, E>(def.init())
  const hy = opts?.hydrate
  let state = hy ? hy.serverState : (opts?.initialState ?? seedState)
  let mount: SignalMount | null = null
  let disposed = false
  // Swappable via swapUpdate (HMR); runReducer/send read these, not def.* .
  let updateFn = def.update
  let onEffectFn = def.onEffect
  let onBindingError: ((e: BindingError) => void) | null = null
  const cleanups: Array<() => void> = []
  const subscribers = new Set<(state: S) => void>()

  const handle = makeHandle<S>(() => state)
  // Dev: capture a message log and register a debug API for the MCP/agent relay.
  const dev = import.meta.env?.DEV === true
  const history: SignalMessageRecord[] = []
  let msgIndex = 0
  let uninstallDebug: (() => void) | null = null

  const runEffect = (effect: E): void => {
    if (onEffectFn === undefined) {
      // An effect was returned from init()/update() but there is no handler to
      // process it — it is silently dropped. This is the classic footgun (e.g.
      // returning a delay/log/http effect with no onEffect wired). Surface it
      // loudly in dev so it doesn't no-op in silence.
      if (dev) {
        console.warn(
          `[llui] ${def.name ?? 'component'}: an effect was emitted but no onEffect ` +
            `handler is registered, so it was dropped. Wire onEffect (e.g. @llui/effects ` +
            `handleEffects, or the delay()/log() builders) to handle it.`,
          effect,
        )
      }
      return
    }
    const cleanup = onEffectFn(effect, { send, batch, state: handle })
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }

  // `send` is reentrancy-safe AND reconcile-coalescing: a message dispatched WHILE
  // another is being processed (the classic case: removing a focused node during
  // `mount.update` fires `blur` synchronously, whose handler calls `send`) is
  // queued and processed by the active drain rather than running a NESTED reducer +
  // reconcile (which would mutate the scope tree / DOM mid-reconcile — corrupting an
  // in-flight `removeBetween` into a NotFoundError, or skipping the outer message's
  // effects). A drain runs every queued reducer to quiescence, then reconciles the
  // DOM ONCE against the settled state — so a synchronous burst of N sends (or a
  // reentrant cascade) commits a single reconcile, not N. `mount.update` tracks its
  // own last-committed state, so that one pass diffs last-commit → settled and
  // commits the cumulative dirty set; intermediate states are never painted (same
  // synchronous turn), so coalescing is render-equivalent. From a top-level caller
  // `send` stays synchronous: the queue is fully drained and committed before it
  // returns, so the "send applies immediately" contract holds at the call boundary.
  const queue: M[] = []
  let draining = false
  // While `batchDepth > 0` (inside `batch(fn)`), reducers still run and effects
  // still fire, but the single commit is deferred to the outermost `batch` exit —
  // extending the per-drain coalescing across several top-level sends (the
  // streaming / bulk-dispatch fast path). `pendingCommit` records that state moved
  // since the last reconcile, gating the commit.
  let batchDepth = 0
  let pendingCommit = false
  // Frame-scheduled mode (`scheduler: 'raf'`): a drain that would commit
  // schedules ONE flush at the next animation frame instead; every send until
  // then coalesces into it. `flushing` makes the nested drain inside that
  // flush (commit-induced sends — a blur from a node removal, a subscriber
  // dispatch) commit synchronously, so a frame settles fully with no cascade.
  const scheduler = opts?.scheduler ?? 'sync'
  let frameScheduled = false
  let rafId: number | null = null
  let flushing = false

  function flushFrame(): void {
    frameScheduled = false
    rafId = null
    if (disposed) return
    flushing = true
    draining = true
    try {
      commitPending()
      if (queue.length > 0) drain() // commit-induced messages settle synchronously
    } finally {
      draining = false
      flushing = false
    }
  }

  function scheduleCommit(): void {
    if (frameScheduled || disposed) return
    frameScheduled = true
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(flushFrame)
    } else {
      // Non-browser fallback (SSR / plain jsdom / headless agent): a microtask.
      // It can't be cancelled — flushFrame/commitPending no-op once nothing is
      // pending, so an already-flushed task is harmless.
      queueMicrotask(flushFrame)
    }
  }

  // Reconcile + notify ONCE against the current state, if it moved since the last
  // commit. The commit can re-enter `send` (a `blur` fired by a node removal), so
  // callers loop until the queue is empty afterwards.
  function commitPending(): void {
    if (!pendingCommit) return
    // During the initial `mount = mountSignal(...)` call below, onMount callbacks
    // run synchronously BEFORE `mount` is assigned. A state-changing send from an
    // onMount callback (or an effect it kicks off whose continuation is synchronous)
    // advances `state` and reaches here while `mount` is still null — committing now
    // would `mount?.update()` no-op and silently drop the reconcile, so the view
    // would stay frozen until a later, unrelated dispatch. Leave `pendingCommit`
    // set and bail; the post-mount flush replays it once `mount` is live.
    if (mount === null) return
    pendingCommit = false
    const next = state
    // Hot per-send path: skip the withBindingErrors wrapper (and its per-commit
    // closure) when no error handler is installed — the common case; a 1k-send
    // burst was allocating 1k closures here. Same for the subscriber sweep: a
    // Set iterator per commit is waste when nobody subscribed.
    if (onBindingError) {
      withBindingErrors(onBindingError, () => mount?.update(next))
    } else {
      mount?.update(next)
    }
    if (subscribers.size > 0) for (const listener of subscribers) listener(next)
  }

  // Process the queue to quiescence: run all queued reducers (collecting their
  // effects), commit once (unless batching), then run the collected effects after
  // the DOM is live — matching the historical per-message "reconcile, then effect"
  // order at settle granularity. A commit or effect may enqueue more (blur, an
  // effect that sends), so loop until the queue drains.
  function drain(): void {
    do {
      // Lazy: most messages emit no effects, and a 1k-send burst drains 1k
      // times — don't allocate an empty array per drain.
      let pendingEffects: E[] | null = null
      while (queue.length > 0) {
        const m = queue.shift() as M
        const before = state
        const [next, effects] = normalize<S, E>(updateFn(state, m))
        if (!Object.is(next, state)) {
          state = next
          pendingCommit = true
        }
        if (dev) {
          history.push({
            index: msgIndex++,
            timestamp: Date.now(),
            msg: m,
            stateBefore: before,
            stateAfter: state,
            effects,
          })
          if (history.length > 1000) history.shift()
        }
        if (effects.length > 0) {
          if (pendingEffects === null) pendingEffects = []
          for (const e of effects) pendingEffects.push(e)
        }
      }
      if (batchDepth === 0) {
        if (scheduler === 'sync' || flushing) commitPending()
        else scheduleCommit()
      }
      if (pendingEffects !== null) for (const e of pendingEffects) runEffect(e)
    } while (queue.length > 0)
  }

  function send(msg: M): void {
    queue.push(msg)
    if (draining) return
    draining = true
    try {
      drain()
    } finally {
      draining = false
    }
  }

  // Coalesce a burst of `send`s into one reconcile (see the handle's `batch` doc).
  // Reentrancy-safe via `batchDepth` (nested `batch` flushes only at the outermost
  // exit). An external batch (not nested in an active drain) drives its own commit
  // drain on exit; a batch entered DURING a drain (e.g. from an effect) leaves the
  // commit to that drain's loop. Flushes even if `fn` throws — state already
  // advanced, so the DOM must catch up to stay consistent.
  function batch(fn: () => void): void {
    batchDepth++
    try {
      fn()
    } finally {
      batchDepth--
      if (batchDepth === 0 && !draining) {
        draining = true
        try {
          drain()
        } finally {
          draining = false
        }
      }
    }
  }

  withBindingErrors(onBindingError, () => {
    // Resolve the attach target: a bare Element (the common case) becomes a
    // container target (replace on hydrate, append on fresh mount); a MountTarget
    // descriptor (e.g. `{ anchor }`) passes through.
    const mt: MountTarget =
      target instanceof Object && ('container' in target || 'anchor' in target)
        ? (target as MountTarget)
        : { container: target as Element, mode: hy ? 'replace' : 'append' }
    mount = mountSignal(mt, state, () => def.view({ state: handle, send, batch }), opts?.contexts)
  })
  // onMount callbacks ran synchronously inside mountSignal above, before `mount`
  // was assigned. If one dispatched a state-changing send, `commitPending` deferred
  // the reconcile (mount was still null); replay it now that `mount` is live so a
  // "compute on mount" view paints its result on first frame instead of waiting for
  // an unrelated later dispatch. In raf mode the deferred commit is already a
  // scheduled frame, so only force it in sync mode.
  if (pendingCommit && scheduler === 'sync') commitPending()
  // Fresh mount always dispatches init effects; hydration skips them unless asked.
  if (hy ? (hy.runInitEffects ?? false) : true) {
    for (const e of initialEffects) runEffect(e)
  }

  if (dev && opts?.devtools !== false) {
    uninstallDebug = installSignalDebug({
      name: def.name ?? 'SignalComponent',
      getState: () => state,
      setState: (s) => {
        state = s as S
        mount?.update(state)
      },
      send: (m) => send(m as M),
      pureUpdate: (s, m) => normalize<S, E>(def.update(s as S, m as M)),
      history,
      clearHistory: () => {
        history.length = 0
      },
      msgSchema: def.__msgSchema,
      stateSchema: def.__stateSchema,
      effectSchema: def.__effectSchema,
      componentMeta: def.__componentMeta,
    })
  }

  return {
    send,
    batch,
    getState: () => state,
    flush: () => {
      // sync mode: send already committed — nothing to flush.
      if (scheduler === 'sync' || disposed) return
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId)
      }
      flushFrame()
    },
    dispose: () => {
      disposed = true
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      subscribers.clear()
      mount?.dispose() // foreign unmounts, subscriptions
      for (const c of cleanups.splice(0)) c()
      uninstallDebug?.()
    },
    subscribe: (listener: (state: S) => void): (() => void) => {
      if (disposed) return () => {}
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    runReducer: (msg: M): { state: S; effects: unknown[] } | null => {
      const [next, effects] = normalize<S, E>(updateFn(state, msg))
      return { state: next, effects }
    },
    getBindingDescriptors: (): Array<{ variant: string }> => mount?.getDescriptors() ?? [],
    swapUpdate: (
      newUpdate: (state: unknown, msg: unknown) => [unknown, unknown[]] | unknown,
      newOnEffect?: unknown,
    ): void => {
      updateFn = newUpdate as typeof updateFn
      if (newOnEffect !== undefined) onEffectFn = newOnEffect as typeof onEffectFn
    },
    setOnBindingError: (hook: ((e: BindingError) => void) | null): void => {
      onBindingError = hook
    },
  }
}

/**
 * Hydrate a signal component over server-rendered HTML in `container`. Builds the
 * client tree against `serverState` (matching the SSR render) and atomically
 * swaps it in — server HTML stays visible until the swap, so no flash. init()'s
 * effects are skipped by default (already run on the server); pass
 * `runInitEffects: true` for init()s that no-op on the server.
 */
export function hydrateSignalApp<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  serverState: S,
  options?: { runInitEffects?: boolean; contexts?: ReadonlyMap<symbol, unknown> },
): SignalComponentHandle<S, M> {
  return mountSignalComponent(target, def, {
    hydrate: { serverState, runInitEffects: options?.runInitEffects },
    contexts: options?.contexts,
  })
}
