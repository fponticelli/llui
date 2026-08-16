import {
  createTeaDriver,
  normalizeUpdateResult,
  type SignalComponentDef,
  type TeaDriver,
  type TeaEffectApi,
  type TeaTransition,
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
   * harness has no DOM to commit, so `batch` establishes one top-level
   * `effects` window across the burst.
   */
  batch: (fn: () => void) => void
  /**
   * Tear down the harness: aborts the per-driver lifecycle `AbortSignal` handed
   * to `onEffect` and runs cleanups returned by `onEffect`. After dispose,
   * `send`/`batch` are inert.
   */
  dispose: () => void
}

export interface TestComponentOptions {
  /**
   * Opt in to the shared runtime's effect drain. In the default pure-reducer
   * mode `testComponent` runs `update()` once per `send` and stops — effects are
   * recorded but not interpreted. With `withEffects: true`, returned effects
   * run through `onEffect`; synchronous effect-driven sends re-enter the shared
   * queue and settle before the top-level send returns.
   */
  withEffects?: boolean
}

/** Drive a component definition without mounting its view. */
export function testComponent<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  options: TestComponentOptions = {},
): TestHarness<S, M, E> {
  // Cache init once: createTeaDriver receives the already-observed result so the
  // component's init function is never evaluated twice.
  const [initState, initEffects] = normalizeUpdateResult(def.init())
  let currentState = initState
  let currentEffects = initEffects
  const allEffects = [...initEffects]
  const history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }> = []
  const refs: { driver?: TeaDriver<S, M>; harness?: TestHarness<S, M, E> } = {}
  let disposed = false
  let callDepth = 0
  let batchDepth = 0
  let implicitEffectDepth = 0
  let windowEffects: E[] | null = null

  function replaceEffects(effects: E[]): void {
    currentEffects = effects
    if (refs.harness !== undefined) refs.harness.effects = effects
  }

  function recordTransition({ previousState, msg, state, effects }: TeaTransition<S, M, E>): void {
    currentState = state
    if (refs.harness !== undefined) refs.harness.state = state
    history.push({ prevState: previousState, msg, nextState: state, effects })
    // Initial effects run during driver construction. If one sends, it owns the
    // same effects window that the old harness opened around that send; an inert
    // init effect leaves `effects` equal to the init effect list.
    if (windowEffects === null && implicitEffectDepth > 0) {
      replaceEffects([])
      windowEffects = currentEffects
    }
    if (windowEffects === null) replaceEffects(effects)
    else for (const effect of effects) windowEffects.push(effect)
    allEffects.push(...effects)
  }

  function send(msg: M): void {
    if (disposed) return
    const ownsWindow = callDepth === 0 && batchDepth === 0
    if (ownsWindow) {
      replaceEffects([])
      windowEffects = currentEffects
    }
    callDepth++
    try {
      refs.driver?.send(msg)
    } finally {
      callDepth--
      if (ownsWindow) windowEffects = null
    }
  }

  function batch(fn: () => void): void {
    if (disposed) return
    const ownsWindow = callDepth === 0 && batchDepth === 0
    if (ownsWindow) {
      replaceEffects([])
      windowEffects = currentEffects
    }
    batchDepth++
    try {
      refs.driver?.batch(fn)
    } finally {
      batchDepth--
      if (ownsWindow) windowEffects = null
    }
  }

  const onEffect = options.withEffects
    ? (effect: E, api: TeaEffectApi<S, M>): void | (() => void) => {
        const implicit = callDepth === 0 && batchDepth === 0
        if (implicit) implicitEffectDepth++
        callDepth++
        try {
          return def.onEffect?.(effect, {
            ...api,
            // During construction `driver` is not assigned yet; the API handed
            // in by createTeaDriver is already the same live queue.
            send: (msg) => (refs.driver === undefined ? api.send(msg) : send(msg)),
            batch: (fn) => (refs.driver === undefined ? api.batch(fn) : batch(fn)),
          })
        } finally {
          callDepth--
          if (implicit) {
            implicitEffectDepth--
            windowEffects = null
          }
        }
      }
    : undefined

  refs.driver = createTeaDriver(
    {
      init: () => [initState, initEffects],
      update: def.update,
      ...(onEffect === undefined ? {} : { onEffect }),
    },
    { onTransition: recordTransition },
  )

  refs.harness = {
    state: currentState,
    effects: currentEffects,
    allEffects,
    history,
    send,
    sendAll(msgs: M[]) {
      for (const msg of msgs) send(msg)
      return refs.driver!.getState()
    },
    batch,
    dispose() {
      if (disposed) return
      disposed = true
      refs.driver!.dispose()
    },
  }
  return refs.harness
}
