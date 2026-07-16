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
 *
 * `onComplete` (optional) is an explicit completion signal used by `sequence` to
 * advance strictly on COMPLETION rather than on the first bubbled message. A leaf
 * effect completes on its first dispatched message (or synchronously if it
 * dispatches none); a composite that manages its own completion (see
 * {@link Runner.managesCompletion}) fires `onComplete` itself — e.g. a NESTED
 * `sequence` fires it only when its own last step completes, so an outer sequence
 * never fast-forwards while an inner one is still running. Fired at most once.
 */
export type DispatchFn = (
  effect: { type: string },
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
  onComplete?: () => void,
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
 *
 * `managesCompletion` (default false) marks a COMPOSITE runner that drives the
 * completion signal itself: instead of `sequence`'s "first bubbled message means
 * done" leaf heuristic, `dispatch` hands such a runner the `onComplete` callback
 * (its 5th `run` argument) and the runner fires it explicitly. Only `sequence`
 * needs this — a nested `sequence` dispatches several messages (one per step), so
 * first-message completion would let an outer sequence fast-forward past a still
 * running inner one. (`race`/`retry`/`debounce`/`cancel`-with-inner each dispatch
 * exactly one terminal message, so the leaf first-message rule is already correct
 * for them.)
 */
export interface Runner {
  readonly types: readonly string[]
  readonly completesWithoutDispatch: boolean
  readonly managesCompletion?: boolean
  run(
    effect: { type: string },
    send: InternalSend,
    signal: AbortSignal,
    deps: Deps,
    onComplete?: () => void,
  ): boolean | void
}

/**
 * Build a {@link DispatchFn} from a set of runners — a `Map<string, Runner>`
 * lookup replacing the former 20+-arm `switch`.
 *
 * Plugins registered via `.use()` run FIRST, on every dispatch level (including
 * effects nested in `sequence`/`race`/`retry`/`cancel`), so a plugin can intercept
 * a built-in kind. An effect no plugin and no runner claims is handed to the
 * terminal `custom` handler.
 *
 * For a plugin- or custom-handled effect the completes-without-dispatch signal is
 * inferred: we wrap `send` and observe whether the handler dispatched a message
 * SYNCHRONOUSLY. If it did, the caller (e.g. `sequence`) already advanced through
 * that wrapped send, so we report `false` (not-complete). If the handler returned
 * without dispatching, we report `true` — a fire-and-forget custom/plugin step
 * then advances the chain instead of stalling it forever. (A handler that only
 * dispatches ASYNCHRONOUSLY is treated as completes-without-dispatch by this
 * default; gate the chain on it with a runner-backed effect if that is wrong.)
 */
export function createDispatch(runners: readonly Runner[]): DispatchFn {
  const map = new Map<string, Runner>()
  for (const runner of runners) {
    for (const type of runner.types) map.set(type, runner)
  }

  return function dispatch(effect, send, signal, deps, onComplete): boolean {
    let completed = false
    const fireComplete = (): void => {
      if (completed) return
      completed = true
      onComplete?.()
    }

    let dispatchedSync = false
    // Leaf semantics: the FIRST dispatched message means "this effect is done", so
    // it doubles as the completion signal for a `sequence` waiting on this step.
    const trackedSend: InternalSend = (msg) => {
      dispatchedSync = true
      send(msg)
      fireComplete()
    }
    for (const plugin of deps.plugins) {
      if (plugin({ effect, send: trackedSend, signal })) {
        // Claimed by a plugin: complete-without-dispatch unless it sent synchronously.
        if (!dispatchedSync) fireComplete()
        return !dispatchedSync
      }
    }
    const runner = map.get(effect.type)
    if (!runner) {
      deps.custom(effect, trackedSend, signal)
      // Terminal custom handler: same inference as plugins.
      if (!dispatchedSync) fireComplete()
      return !dispatchedSync
    }
    if (runner.managesCompletion) {
      // Composite runner drives completion itself: pass the raw `send` (messages
      // flow straight through, un-latched) plus the explicit `fireComplete`.
      const dynamic = runner.run(effect, send, signal, deps, fireComplete)
      return dynamic ?? runner.completesWithoutDispatch
    }
    // Leaf runner: completion is its first dispatched message (via `trackedSend`),
    // or fires synchronously here when it completes without dispatching.
    const dynamic = runner.run(effect, trackedSend, signal, deps)
    const completes = dynamic ?? runner.completesWithoutDispatch
    if (completes) fireComplete()
    return completes
  }
}
