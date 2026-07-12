import {
  normalizeUpdateResult,
  pathHandle,
  type SignalComponentDef,
  type EffectApi,
} from '@llui/dom'

export interface TestHarness<S, M, E> {
  /** Current state (after the most recent `send`/`sendAll`/`batch`). */
  state: S
  /**
   * Effects produced by the MOST RECENT top-level `send` (or `batch`, or
   * `init`). In `withEffects` mode a single `send` can run several reducers
   * (the effect→send cascade); this holds every effect emitted across that
   * whole drain, in emission order.
   */
  effects: E[]
  /** Every effect emitted since construction (init effects first). */
  allEffects: E[]
  /**
   * One entry per reducer run, in order. In `withEffects` mode a cascade adds
   * several entries under one `send`.
   */
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send: (msg: M) => void
  sendAll: (msgs: M[]) => S
  /**
   * Coalesce a burst of `send`s (see the runtime handle's `batch`). Reducers
   * and — in `withEffects` mode — effects still run per message in order; the
   * harness has no DOM to commit, so `batch` here is a faithful structural
   * mirror (it establishes one top-level `effects` window across the burst).
   */
  batch: (fn: () => void) => void
  /**
   * Tear down the harness: aborts the per-mount lifecycle `AbortSignal` handed
   * to `onEffect` (so effect handlers keyed off `api.signal` clean up) and runs
   * any cleanups returned by `onEffect`. After dispose, `send`/`batch` are
   * inert (matching the runtime's after-dispose drop). No-op in the default
   * pure-reducer mode beyond aborting the signal.
   */
  dispose: () => void
}

export interface TestComponentOptions {
  /**
   * Opt in to faithfully replicating the runtime's effect drain. In the default
   * (pure-reducer) mode `testComponent` runs `update()` once per `send` and
   * stops — effects are recorded but never dispatched. The real runtime instead
   * dispatches every returned effect to `onEffect`, which commonly calls `send`
   * synchronously; the terminal state after such a cascade differs from the
   * pure-reducer state ("green tests lie").
   *
   * With `withEffects: true` the harness replicates the runtime loop exactly:
   * a queue-based `send`, reducers run to quiescence, then the collected
   * effects dispatch in order through the def's `onEffect` with a real
   * {@link EffectApi} (including this mount's lifecycle `signal`); effect-driven
   * `send`s re-enter the same queue, so a cascade settles to the same terminal
   * state a real `mountApp` reaches.
   */
  withEffects?: boolean
}

export function testComponent<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  options: TestComponentOptions = {},
): TestHarness<S, M, E> {
  return options.withEffects ? effectDrivenHarness(def) : pureReducerHarness(def)
}

/** Default: pure reducer, one `update()` per `send`, effects recorded only. */
function pureReducerHarness<S, M, E>(def: SignalComponentDef<S, M, E>): TestHarness<S, M, E> {
  const lifecycle = new AbortController()
  const [initState, initEffects] = normalizeUpdateResult(def.init())

  const harness: TestHarness<S, M, E> = {
    state: initState,
    effects: initEffects,
    allEffects: [...initEffects],
    history: [],

    send(msg: M) {
      if (lifecycle.signal.aborted) return
      const prevState = harness.state
      const [nextState, effects] = normalizeUpdateResult(def.update(prevState, msg))
      harness.history.push({ prevState, msg, nextState, effects })
      harness.state = nextState
      harness.effects = effects
      harness.allEffects.push(...effects)
    },

    sendAll(msgs: M[]) {
      for (const msg of msgs) harness.send(msg)
      return harness.state
    },

    // No commit and no effect dispatch in pure mode, so `batch` is just the
    // burst of sends run back-to-back — kept for API parity with the runtime
    // handle and the withEffects harness.
    batch(fn: () => void) {
      if (lifecycle.signal.aborted) return
      fn()
    },

    dispose() {
      if (!lifecycle.signal.aborted) lifecycle.abort()
    },
  }

  return harness
}

/**
 * `withEffects` mode: a headless mirror of the signal runtime's TEA loop
 * (`packages/dom/src/signals/component.ts`) with the DOM commit removed. The
 * queue / `draining` / `batchDepth` structure, drain-to-quiescence ordering,
 * and per-effect dispatch are replicated 1:1 so terminal state matches a real
 * `mountApp` for effect-driven cascades. A parity test pins this against
 * `@llui/dom`'s observable behavior.
 */
function effectDrivenHarness<S, M, E>(def: SignalComponentDef<S, M, E>): TestHarness<S, M, E> {
  const lifecycle = new AbortController()
  const cleanups: Array<() => void> = []
  // A read handle over the live `state` closure — the same shape `EffectApi.state`
  // carries in the runtime (`.at(path).peek()` / `.peek()` read current state).
  const stateHandle = pathHandle<S>(() => harness.state, '')

  const queue: M[] = []
  let draining = false
  let batchDepth = 0
  // Collector for the CURRENT top-level window (a `send` not nested in a drain,
  // or a `batch`). Points at `harness.effects` while open so a whole cascade's
  // effects land there; null between windows.
  let windowEffects: E[] | null = null

  const runEffect = (effect: E): void => {
    const onEffect = def.onEffect
    if (onEffect === undefined) return // no handler: dropped, same as the runtime
    const cleanup = onEffect(effect, {
      send,
      batch,
      state: stateHandle,
      signal: lifecycle.signal,
    } satisfies EffectApi<S, M>)
    if (typeof cleanup === 'function') {
      // Torn down while the (possibly async) handler ran: run the cleanup now so
      // nothing it opened is stranded — mirrors the runtime.
      if (lifecycle.signal.aborted) cleanup()
      else cleanups.push(cleanup)
    }
  }

  // Drain the queue to quiescence: run every queued reducer (collecting effects
  // + history), then dispatch the collected effects in order. A dispatched
  // effect may `send` (re-enters the queue), so loop until the queue empties.
  const drain = (): void => {
    do {
      let pendingEffects: E[] | null = null
      while (queue.length > 0) {
        const msg = queue.shift() as M
        const prevState = harness.state
        const [nextState, effects] = normalizeUpdateResult(def.update(prevState, msg))
        harness.state = nextState
        harness.history.push({ prevState, msg, nextState, effects })
        if (effects.length > 0) {
          if (windowEffects) for (const e of effects) windowEffects.push(e)
          harness.allEffects.push(...effects)
          if (pendingEffects === null) pendingEffects = []
          for (const e of effects) pendingEffects.push(e)
        }
      }
      if (pendingEffects !== null) for (const e of pendingEffects) runEffect(e)
    } while (queue.length > 0)
  }

  function send(msg: M): void {
    if (lifecycle.signal.aborted) return
    queue.push(msg)
    if (draining) return
    // Open a fresh top-level effects window unless we're inside a `batch` (which
    // owns the window spanning the whole burst).
    const ownsWindow = batchDepth === 0
    if (ownsWindow) {
      harness.effects = []
      windowEffects = harness.effects
    }
    draining = true
    try {
      drain()
    } finally {
      draining = false
      if (ownsWindow) windowEffects = null
    }
  }

  function batch(fn: () => void): void {
    if (lifecycle.signal.aborted) return
    const outermost = batchDepth === 0 && !draining
    if (outermost) {
      harness.effects = []
      windowEffects = harness.effects
    }
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
          if (outermost) windowEffects = null
        }
      }
    }
  }

  const [initState, initEffects] = normalizeUpdateResult(def.init())

  const harness: TestHarness<S, M, E> = {
    state: initState,
    effects: initEffects,
    allEffects: [...initEffects],
    history: [],
    send,
    sendAll(msgs: M[]) {
      for (const msg of msgs) send(msg)
      return harness.state
    },
    batch,
    dispose() {
      if (lifecycle.signal.aborted) return
      lifecycle.abort()
      // Run in reverse (LIFO) — the same teardown order the runtime uses.
      for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
      cleanups.length = 0
    },
  }

  // Mount-time init effects dispatch after state is seeded (the runtime runs
  // them directly, after the view is built — component.ts). Each is dispatched
  // one-by-one; an init effect that `send`s opens its own drain, exactly as the
  // runtime does, so no window is held open across them.
  for (const e of initEffects) runEffect(e)

  return harness
}
