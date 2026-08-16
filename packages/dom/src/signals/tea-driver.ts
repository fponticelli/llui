import { createCommitScheduler, type CommitHost, type CommitMode } from './commit-scope.js'
import { pathHandle } from './handle.js'
import type { Signal } from './types.js'

/**
 * The view-less part of an LLui component: initial state, a pure reducer, and
 * an optional effect interpreter. Pass this to {@link createTeaDriver} when a
 * state machine needs the framework's real dispatch semantics without a DOM.
 */
export interface TeaProgram<S, M, E = never> {
  /** Produce the initial state and, optionally, effects to run after creation. */
  init: () => S | [S, E[]]
  /** Fold one message over the current state and optionally emit effects. */
  update: (state: S, msg: M) => S | [S, E[]]
  /** Interpret an emitted effect. A returned cleanup runs on driver disposal. */
  onEffect?: (effect: E, api: TeaEffectApi<S, M>) => void | (() => void)
}

/** The capabilities available while a {@link TeaProgram} interprets an effect. */
export interface TeaEffectApi<S, M> {
  /** Queue a message in the current drain; effect-driven sends are reentrancy-safe. */
  send: (msg: M) => void
  /** Read the driver's live state with the same signal handle used by mounted effects. */
  state: Signal<S>
  /** Group sends into one settled state notification. */
  batch: (fn: () => void) => void
  /** Aborted exactly once when this driver is disposed. */
  signal: AbortSignal
}

/**
 * One completed reducer call, observed after its state and effects have been
 * accepted but before the settled state is committed or its effects run.
 */
export interface TeaTransition<S, M, E> {
  /** State supplied to the reducer. */
  readonly previousState: S
  /** Message supplied to the reducer. */
  readonly msg: M
  /** State returned by the reducer. */
  readonly state: S
  /** Effects returned by the reducer, in their original order. */
  readonly effects: E[]
}

/**
 * Optional observers for a {@link TeaDriver}. With `onTransition` absent, the
 * hot reducer path does not allocate a transition record.
 */
export interface TeaDriverOptions<S, M, E> {
  /**
   * Called synchronously after every reducer call, including calls made inside
   * a batch and calls caused by an effect. It runs after state advances and
   * effects are collected, but before the settled-state notification and effect
   * dispatch. Throwing aborts that settle round: the state already returned by
   * the reducer remains current, while that round's effects are dropped.
   */
  onTransition?: (transition: TeaTransition<S, M, E>) => void
  /**
   * Called synchronously when a changed state settles: once for a plain send,
   * once at the outermost batch exit, and again for each effect-driven settle.
   * It runs before that settle's effects. Throwing aborts the round and drops
   * those effects, matching a mounted commit that throws.
   */
  onStateChange?: (state: S) => void
}

/**
 * A view-less LLui TEA runtime. It uses the same queue, reentrancy guard,
 * effect-frame ordering, and batching machinery as a mounted component.
 */
export interface TeaDriver<S, M> {
  /**
   * Dispatch a message synchronously. Before this returns, the reducer queue,
   * settled-state notification, and any synchronous effect-driven sends have
   * all reached quiescence.
   */
  send(msg: M): void
  /**
   * Run a burst of sends and notify {@link TeaDriverOptions.onStateChange} once
   * with the outermost batch's settled state. Reducers and effects still run in
   * message order, and nested batches join the outer batch.
   */
  batch(fn: () => void): void
  /** Read the current state, including updates made earlier in an open batch. */
  getState(): S
  /**
   * Flush an owed commit. The public view-less driver is synchronous, so this is
   * normally a no-op; it exists for handle parity with mounted drivers.
   */
  flush(): void
  /**
   * Abort the lifecycle signal, stop accepting messages, and run effect
   * cleanups once in registration order. Later sends and batches are ignored.
   */
  dispose(): void
}

/**
 * Normalize an `init()` / `update()` result — a `[state, effects]` tuple or a
 * bare `state` — to a pair. This is the one place the shape heuristic lives;
 * mounted components, SSR, the view-less driver, and `@llui/test` all use it.
 *
 * A two-element array whose second element is itself an array is read as the
 * tuple; every other value is a bare state with no effects. Consequently, a
 * state that is itself a two-tuple with an array in its second slot is ambiguous
 * and must be returned explicitly as `[state, []]`.
 */
export function normalizeUpdateResult<S, E>(result: S | [S, E[]]): [S, E[]] {
  if (Array.isArray(result) && result.length === 2 && Array.isArray((result as [S, E[]])[1])) {
    return result as [S, E[]]
  }
  return [result as S, []]
}

interface TeaDriverCoreOptions<S, M, E> {
  initialState: S
  update: (state: S, msg: M) => S | [S, E[]]
  runEffect: (effect: E) => void
  commit: (state: S) => boolean
  isDisposed: () => boolean
  scheduler: CommitMode
  onTransition?: (transition: TeaTransition<S, M, E>) => void
}

/** @internal Runtime-only controls kept off the supported public driver handle. */
export interface TeaDriverController<S, M, E> {
  replaceState(state: S): void
  replaceUpdate(update: (state: S, msg: M) => S | [S, E[]]): void
  pokeCommit(): void
  replayPostMountCommit(): void
  dispatchEffects(effects: readonly E[]): void
  shutdown(): void
}

/** @internal Shared core used by both `createTeaDriver` and the mounted runtime. */
export function createTeaDriverCore<S, M, E>(
  options: TeaDriverCoreOptions<S, M, E>,
): { driver: Omit<TeaDriver<S, M>, 'dispose'>; controller: TeaDriverController<S, M, E> } {
  let state = options.initialState
  let update = options.update
  let pendingEffects: E[] | null = null

  const host: CommitHost<M, E[] | null> = {
    reduce: (msg): boolean => {
      const previousState = state
      const [nextState, effects] = normalizeUpdateResult(update(state, msg))
      const moved = !Object.is(nextState, state)
      if (moved) state = nextState
      if (effects.length > 0) {
        if (pendingEffects === null) pendingEffects = []
        for (const effect of effects) pendingEffects.push(effect)
      }
      // This object is deliberately conditional: mounted components install no
      // observer, so their per-message hot path pays no transition allocation.
      options.onTransition?.({ previousState, msg, state: nextState, effects })
      return moved
    },
    commit: (): boolean => options.commit(state),
    beginEffects: (): E[] | null => {
      const previous = pendingEffects
      pendingEffects = null
      return previous
    },
    dispatchEffects: (): void => {
      const effects = pendingEffects
      pendingEffects = null
      if (effects !== null) for (const effect of effects) options.runEffect(effect)
    },
    endEffects: (previous): void => {
      pendingEffects = previous
    },
    isDisposed: options.isDisposed,
  }

  const scheduler = createCommitScheduler(host, options.scheduler)
  const driver: Omit<TeaDriver<S, M>, 'dispose'> = {
    send: (msg): void => scheduler.dispatch(msg),
    batch: (fn): void => scheduler.batch(fn),
    getState: (): S => state,
    flush: (): void => scheduler.flushNow(),
  }

  return {
    driver,
    controller: {
      replaceState: (nextState): void => {
        state = nextState
      },
      replaceUpdate: (nextUpdate): void => {
        update = nextUpdate
      },
      pokeCommit: (): void => scheduler.pokeCommit(),
      replayPostMountCommit: (): void => scheduler.replayPostMountCommit(),
      dispatchEffects: (effects): void => {
        for (const effect of effects) options.runEffect(effect)
      },
      shutdown: (): void => scheduler.shutdown(),
    },
  }
}

/**
 * Create a supported, view-less LLui TEA driver.
 *
 * This is the same reduction and effect-scheduling path used by
 * `mountSignalComponent`, with the DOM commit replaced by the optional
 * {@link TeaDriverOptions.onStateChange} observer. Initial effects run after the
 * driver and its live state handle are ready. The driver is synchronous: a call
 * to `send` returns only after reentrant effect-driven messages have settled.
 */
export function createTeaDriver<S, M, E = never>(
  program: TeaProgram<S, M, E>,
  options: TeaDriverOptions<S, M, E> = {},
): TeaDriver<S, M> {
  const lifecycle = new AbortController()
  const cleanups: Array<() => void> = []
  let disposed = false
  const [initialState, initialEffects] = normalizeUpdateResult(program.init())
  const stateHandle = pathHandle<S>(() => core.driver.getState(), '')

  const runEffect = (effect: E): void => {
    if (disposed || program.onEffect === undefined) return
    const cleanup = program.onEffect(effect, {
      send: (msg) => {
        if (!disposed) core.driver.send(msg)
      },
      batch: (fn) => {
        if (!disposed) core.driver.batch(fn)
      },
      state: stateHandle,
      signal: lifecycle.signal,
    })
    if (typeof cleanup === 'function') {
      if (disposed) cleanup()
      else cleanups.push(cleanup)
    }
  }

  const core = createTeaDriverCore({
    initialState,
    update: program.update,
    runEffect,
    commit: (state): boolean => {
      options.onStateChange?.(state)
      return true
    },
    isDisposed: () => disposed,
    scheduler: 'sync',
    onTransition: options.onTransition,
  })

  const driver: TeaDriver<S, M> = {
    ...core.driver,
    send: (msg): void => {
      if (!disposed) core.driver.send(msg)
    },
    batch: (fn): void => {
      if (!disposed) core.driver.batch(fn)
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      lifecycle.abort()
      core.controller.shutdown()
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }

  core.controller.dispatchEffects(initialEffects)
  return driver
}
