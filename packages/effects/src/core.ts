// ── Runner registry core ─────────────────────────────────────────
//
// Internal plumbing shared by every runner and by the handler chain. This module
// deliberately imports NO runner module, so runners can import the `Runner`/`Deps`
// contract from here without a cycle.

// Internal send type — widened for dynamic message creation (http onSuccess/onError)
export type InternalSend = (msg: unknown) => void

export type InternalHandler = (
  effect: { type: string },
  send: InternalSend,
  signal: AbortSignal,
) => void

export type PluginFn = (ctx: {
  effect: { type: string }
  send: (msg: unknown) => void
  signal: AbortSignal
}) => boolean

/**
 * Per-mount registry of stateful effect resources. One is created lazily per
 * distinct `AbortSignal` (i.e. per mount — each mount owns its own signal) and is
 * torn down exactly once when that signal aborts. Keying off the signal (rather
 * than a chain- or definition-level closure) is what keeps two concurrent mounts
 * of the same component isolated: disposing one mount never cancels the other's
 * in-flight http / intervals / debounces / websockets, and there is no one-shot
 * `cleanupRegistered` latch to starve a later mount of its teardown.
 */
export interface Registry {
  cancelControllers: Map<string, AbortController>
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>
  websockets: Map<string, WebSocket>
}

/**
 * Dispatch one effect. Returns whether the effect COMPLETES WITHOUT DISPATCHING a
 * message (see {@link Runner.completesWithoutDispatch}).
 */
export type DispatchFn = (
  effect: { type: string },
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
) => boolean

/** Shared, per-mount context threaded through every (recursive) dispatch. */
export interface Deps {
  registry: Registry
  custom: InternalHandler
  plugins: readonly PluginFn[]
  /** Recursive dispatch — used by `cancel`/`debounce`/`sequence`/`race`/`retry`. */
  dispatch: DispatchFn
}

/**
 * A single effect runner. `types` are the effect `type` discriminants this runner
 * claims; `run` executes the effect; `completesWithoutDispatch` is the static
 * signal used by `sequence` to advance past a fire-and-forget step immediately —
 * a step that never calls `send` would otherwise stall the chain forever.
 *
 * `run` may RETURN a boolean to override `completesWithoutDispatch` on a per-call
 * basis (only `cancel` needs this: bare `cancel` completes without dispatching,
 * but `cancel(token, inner)` may dispatch via its inner effect). Returning
 * `undefined`/`void` falls back to the static `completesWithoutDispatch`.
 */
export interface Runner {
  readonly types: readonly string[]
  readonly completesWithoutDispatch: boolean
  run(effect: { type: string }, send: InternalSend, signal: AbortSignal, deps: Deps): boolean | void
}

/**
 * Build a {@link DispatchFn} from a set of runners — a `Map<string, Runner>`
 * lookup replacing the former 20+-arm `switch`.
 *
 * Plugins registered via `.use()` run FIRST, on every dispatch level (including
 * effects nested in `sequence`/`race`/`retry`/`cancel`), so a plugin can intercept
 * a built-in kind. A plugin that claims an effect returns `false` here (we can't
 * know whether it dispatched). An effect no plugin and no runner claims is handed
 * to the terminal `custom` handler.
 */
export function createDispatch(runners: readonly Runner[]): DispatchFn {
  const map = new Map<string, Runner>()
  for (const runner of runners) {
    for (const type of runner.types) map.set(type, runner)
  }

  return function dispatch(effect, send, signal, deps): boolean {
    for (const plugin of deps.plugins) {
      if (plugin({ effect, send: send as unknown as (msg: unknown) => void, signal })) return false
    }
    const runner = map.get(effect.type)
    if (!runner) {
      deps.custom(effect, send, signal)
      return false
    }
    const dynamic = runner.run(effect, send, signal, deps)
    return dynamic ?? runner.completesWithoutDispatch
  }
}
