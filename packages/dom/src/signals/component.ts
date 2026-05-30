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

import { mountSignal, type SignalMount, type MountTarget } from './dom.js'
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
}

export interface EffectApi<S, M> {
  send: (msg: M) => void
  state: Signal<S>
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
  view: (bag: ComponentBag<S, M>) => readonly Node[]
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
    const cleanup = onEffectFn?.(effect, { send, state: handle })
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }

  function send(msg: M): void {
    const before = state
    const [next, effects] = normalize<S, E>(updateFn(state, msg))
    if (!Object.is(next, state)) {
      state = next
      withBindingErrors(onBindingError, () => mount?.update(next))
      for (const listener of subscribers) listener(state)
    }
    if (dev) {
      history.push({
        index: msgIndex++,
        timestamp: Date.now(),
        msg,
        stateBefore: before,
        stateAfter: state,
        effects,
      })
      if (history.length > 1000) history.shift()
    }
    for (const e of effects) runEffect(e)
  }

  withBindingErrors(onBindingError, () => {
    // Resolve the attach target: a bare Element (the common case) becomes a
    // container target (replace on hydrate, append on fresh mount); a MountTarget
    // descriptor (e.g. `{ anchor }`) passes through.
    const mt: MountTarget =
      target instanceof Object && ('container' in target || 'anchor' in target)
        ? (target as MountTarget)
        : { container: target as Element, mode: hy ? 'replace' : 'append' }
    mount = mountSignal(mt, state, () => def.view({ state: handle, send }), opts?.contexts)
  })
  // Fresh mount always dispatches init effects; hydration skips them unless asked.
  if (hy ? (hy.runInitEffects ?? false) : true) {
    for (const e of initialEffects) runEffect(e)
  }

  if (dev) {
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
    getState: () => state,
    flush: () => {}, // send is synchronous — nothing to flush
    dispose: () => {
      disposed = true
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
