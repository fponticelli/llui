import {
  createTeaDriver,
  mountApp,
  normalizeUpdateResult,
  type MountSignalOptions,
  type SignalComponentDef,
  type SignalComponentHandle,
} from '@llui/dom'
import { mulberry32, randomSeed } from './internal/prng.js'

/**
 * What a mounted run does about resources it finds still live after `dispose()`.
 *
 * - `'error'` — report as a property failure (with the scheduling stack). Use it
 *   when you own every effect in the component under test.
 * - `'warn'` — the DEFAULT. Report once per `propertyTest` call on `console.warn`
 *   and let the run pass. The sweep is indiscriminate by construction — it sees
 *   every timer scheduled while the window is open, including ones the
 *   environment or a third-party library armed — and a timer can be armed at
 *   `dispose()` without being a defect (a one-shot that checks `signal.aborted`
 *   when it fires cannot dispatch into a disposed handle). When the timer lives
 *   inside a library the author cannot act on the report at all, so failing by
 *   default would break suites over something they cannot fix.
 * - `'off'` — do not sweep. The harness then installs NO scheduling wrappers, so
 *   nothing patches the timer globals and no stack is captured per timer.
 */
export type LeakPolicy = 'error' | 'warn' | 'off'

export interface PropertyTestConfig<S, M, E> {
  invariants: Array<(state: S, effects: E[]) => boolean>
  messageGenerators: Record<string, ((state: S) => M) | (() => M)>
  runs?: number
  maxSequenceLength?: number
  /**
   * Seed for the pseudo-random sequence-length + generator-selection stream.
   * When omitted a fresh random seed is chosen per call. The seed is ALWAYS
   * printed in a failure's thrown message so you can pin it here to replay the
   * exact same run sequence deterministically and reproduce the failure.
   */
  seed?: number
  /**
   * When set, propertyTest mounts the component into a real DOM
   * container (requires jsdom/happy-dom in the test environment) and
   * dispatches the random message sequence through `handle.send` +
   * `handle.flush`. Catches reconcile races, disposer throws, and
   * binding-accessor errors that pure reducer-level invariants miss
   * — the dungeonlogs issue #3 class.
   *
   * The fixture asserts:
   *   - every dispatched commit completes without throwing the
   *     dev-mode panic (an earlier accessor threw),
   *   - no `console.error` calls fire (binding accessor + reconcile
   *     errors all surface there in dev mode),
   *   - the user-supplied `assertDom(state, container)` returns true
   *     after each commit,
   *   - the run left no timer armed after `dispose()` — see `leaks`
   *     for how that is reported (a warning by default).
   *
   * `assertDom` runs in a try/catch — a throw inside it is rethrown
   * with the failing sequence appended, same as invariant failures.
   */
  mount?: {
    container?: () => HTMLElement
    assertDom?: (state: S, container: HTMLElement) => boolean | void
    /**
     * Forwarded verbatim to `mountApp`, so the run exercises the mode the app
     * really runs in — e.g. `{ scheduler: 'raf' }`, where commits coalesce per
     * frame (each step still `flush`es, so `assertDom` sees a current DOM).
     * Omitted means the runtime defaults, i.e. `scheduler: 'sync'`.
     *
     * The WHOLE bag is accepted, `initialState`/`hydrate` included — unlike
     * `testView`, mount mode has no competing seed of its own to shadow. A seed
     * given here applies to mount mode ONLY (generation and the shrink replay
     * both go through the mounted component, so they agree): a `propertyTest`
     * without a `mount` block runs the reducer from `def.init()`, so a run
     * seeded with a state `init()` never produces explores a different region
     * of the state space than the same definition checked in reducer mode —
     * that asymmetry is the seed you asked for, not a runtime divergence.
     */
    options?: MountSignalOptions<S>
    /** How to report resources still live after `dispose()`. Default `'warn'`. */
    leaks?: LeakPolicy
  }
}

type StepMsg<M> = { name: string; msg: M }

/**
 * Supplies the next message given the current state and step index, or null to
 * stop. Generation reads live state (one reducer run per message); replay
 * ignores state and walks a fixed recorded list.
 */
type NextMsg<S, M> = (state: S, index: number) => StepMsg<M> | null

/**
 * A reproduced failure. `kind` + `invariantIndex` identify the failure so the
 * shrinker keeps only candidates that reproduce the *same* failure (a shorter
 * sequence that fails a different way is not a valid minimization).
 */
interface Failure {
  kind: 'invariant' | 'commit-throw' | 'assert-dom' | 'assert-dom-throw' | 'console-error' | 'leak'
  invariantIndex?: number
  detail: string
}

interface RunResult<M> {
  failure: Failure | null
  /** The concrete messages actually dispatched (for shrinking + reporting). */
  msgs: Array<StepMsg<M>>
}

function sameFailure(a: Failure, b: Failure): boolean {
  return a.kind === b.kind && a.invariantIndex === b.invariantIndex
}

/** First violated invariant at this state, as a Failure — or null. */
function checkInvariants<S, E>(
  invariants: Array<(state: S, effects: E[]) => boolean>,
  state: S,
  effects: E[],
): Failure | null {
  for (let i = 0; i < invariants.length; i++) {
    if (!invariants[i]!(state, effects)) {
      return {
        kind: 'invariant',
        invariantIndex: i,
        detail: `State: ${JSON.stringify(state)}\nEffects: ${JSON.stringify(effects)}`,
      }
    }
  }
  return null
}

/**
 * Reducer-mode run. Steps through the pure reducer — the harness IS the system
 * under test, so a shadow reduction is correct here. `next` drives message
 * selection (generation reads live state, so the reducer runs exactly once per
 * message; replay walks a fixed list).
 */
function runReducer<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  config: PropertyTestConfig<S, M, E>,
  next: NextMsg<S, M>,
): RunResult<M> {
  const msgs: Array<StepMsg<M>> = []
  const [initState, initEffects] = normalizeUpdateResult(def.init())
  let effects = initEffects
  const driver = createTeaDriver(
    { init: () => [initState, initEffects], update: def.update },
    { onTransition: (transition) => (effects = transition.effects) },
  )
  const first = checkInvariants(config.invariants, driver.getState(), initEffects)
  if (first) return { failure: first, msgs }

  for (let i = 0; ; i++) {
    const step = next(driver.getState(), i)
    if (!step) break
    msgs.push(step)
    driver.send(step.msg)
    const f = checkInvariants(config.invariants, driver.getState(), effects)
    if (f) return { failure: f, msgs }
  }
  return { failure: null, msgs }
}

/** A timer the run scheduled and never cleared: still armed when `dispose()` ran. */
interface PendingTimer {
  kind: 'setTimeout' | 'setInterval'
  delayMs: number
  /**
   * Where it was scheduled, so the report names the effect that leaked it. Held
   * as the Error itself, not a string: engines capture the structured trace on
   * construction but FORMAT `.stack` lazily, so a timer that is never reported
   * (the overwhelming majority — every cleared timer, every one of `runs`
   * replays) costs no string work at all.
   */
  origin: Error
}

/** Bookkeeping shape: a `PendingTimer` plus whether it has already fired. */
interface TrackedTimer extends PendingTimer {
  fired: boolean
}

/** Reads back the timers a tracked window left armed (see `withTimerTracking`). */
interface TimerTracker {
  pending(): PendingTimer[]
}

type TimerCallback = (...args: unknown[]) => void
type TimerId = ReturnType<typeof setTimeout>

/**
 * The scheduling globals the tracker borrows, typed STRUCTURALLY on purpose:
 * `globalThis` satisfies this shape under both the DOM and the Node timer
 * declarations, so installing the wrappers needs no cast (`typeof
 * globalThis.setTimeout` would drag in Node's `__promisify__` member and force
 * one). Aliasing `globalThis` to this interface writes through to the real
 * globals — same object, only narrowed.
 *
 * The narrowing is a typing convenience; REPLACING the functions is not. While
 * the window is open the installed wrappers carry only what this interface
 * declares, so a Node-only annex like `setTimeout.__promisify__` is absent —
 * `promisify(setTimeout)` called from inside a run would fail. The window is
 * synchronous and covers one mounted run, so nothing in the harness does that,
 * but `leaks: 'off'` is the way out if a component under test does.
 */
interface TimerGlobals {
  setTimeout: (callback: TimerCallback, delayMs?: number, ...args: unknown[]) => TimerId
  clearTimeout: (id?: TimerId) => void
  setInterval: (callback: TimerCallback, delayMs?: number, ...args: unknown[]) => TimerId
  clearInterval: (id?: TimerId) => void
}

/**
 * This module's own file location, read from a stack frame at load time. Frames
 * are dropped from a report by EXACT source, not by basename: matching
 * `property-test.ts` by name would strip the frames of a consumer whose own file
 * happens to carry that name — exactly the frames that name the leaking effect.
 */
const SELF_LOCATION: string | null = (() => {
  const frame = (new Error().stack ?? '').split('\n')[1]
  const match =
    frame === undefined ? null : /((?:file|https?):\/\/\S+?|\/\S+?):\d+:\d+\)?\s*$/.exec(frame)
  return match ? match[1]! : null
})()

/** The scheduling call site, minus this file's own wrapper frames. */
function formatOrigin(origin: Error): string {
  const frames = (origin.stack ?? '').split('\n').slice(1)
  const isSelf = (line: string): boolean =>
    SELF_LOCATION === null ? /property-test\.(ts|js)/.test(line) : line.includes(SELF_LOCATION)
  return frames
    .filter((line) => !isSelf(line))
    .slice(0, 3)
    .join('\n')
}

/**
 * Runs `body` with the timer schedulers wrapped so it can ask, afterwards, which
 * timers the window left armed. The originals are restored in a `finally` around
 * the whole body — same construction rule as the console capture below: the
 * window must not be able to end without the globals going back.
 *
 * Wrapping the global is the only route: the component under test schedules
 * through `globalThis`, and there is no clock to inject into it. When `enabled`
 * is false (`leaks: 'off'`) nothing is wrapped at all, so an opted-out run leaves
 * the globals byte-identical and pays nothing per timer.
 *
 * The window is indiscriminate by construction: it records every timer scheduled
 * while it is open, including any the environment or a third-party library
 * schedules during mount/send/assertDom. That is why the default policy warns
 * rather than fails.
 */
function withTimerTracking<T>(enabled: boolean, body: (tracker: TimerTracker) => T): T {
  if (!enabled) return body({ pending: () => [] })

  const timers: TimerGlobals = globalThis
  const realSetTimeout = timers.setTimeout
  const realClearTimeout = timers.clearTimeout
  const realSetInterval = timers.setInterval
  const realClearInterval = timers.clearInterval
  // Bound at capture: a WebIDL-defined `Window` method throws "Illegal
  // invocation" in a real browser when called with `this === undefined`, which is
  // what an ESM-strict-mode call through a bare local would do.
  const scheduleTimeout = realSetTimeout.bind(globalThis)
  const cancelTimeout = realClearTimeout.bind(globalThis)
  const scheduleInterval = realSetInterval.bind(globalThis)
  const cancelInterval = realClearInterval.bind(globalThis)
  const live = new Map<TimerId, TrackedTimer>()

  timers.setTimeout = (callback, delayMs, ...args) => {
    const record: TrackedTimer = {
      kind: 'setTimeout',
      delayMs: delayMs ?? 0,
      origin: new Error(),
      fired: false,
    }
    // A one-shot that FIRES inside the window has stopped being a leak, so mark
    // it as it runs. The window is synchronous today so this cannot happen — the
    // flag is what stops the tracker turning into a false-positive machine the
    // day a run learns to await. The callback still runs exactly once, unchanged,
    // and its throw still propagates to the scheduler.
    const onFire: TimerCallback = (...firedArgs) => {
      record.fired = true
      callback(...firedArgs)
    }
    const id = scheduleTimeout(onFire, delayMs, ...args)
    live.set(id, record)
    return id
  }
  // An interval stays armed until it is cleared, so firing changes nothing here.
  timers.setInterval = (callback, delayMs, ...args) => {
    const id = scheduleInterval(callback, delayMs, ...args)
    live.set(id, {
      kind: 'setInterval',
      delayMs: delayMs ?? 0,
      origin: new Error(),
      fired: false,
    })
    return id
  }
  timers.clearTimeout = (id) => {
    if (id !== undefined) live.delete(id)
    cancelTimeout(id)
  }
  timers.clearInterval = (id) => {
    if (id !== undefined) live.delete(id)
    cancelInterval(id)
  }

  try {
    return body({ pending: () => [...live.values()].filter((t) => !t.fired) })
  } finally {
    // Restore what was installed on the way IN, which may itself be a test
    // framework's fake clock — never a hardcoded reference to the real one.
    timers.setTimeout = realSetTimeout
    timers.clearTimeout = realClearTimeout
    timers.setInterval = realSetInterval
    timers.clearInterval = realClearInterval
  }
}

/**
 * Runs `body` with `console.error` swapped for a collector and restores the
 * ORIGINAL function however `body` exits — normal return, early return from a
 * failure branch, or throw. The restore is a `finally` around the WHOLE body BY
 * CONSTRUCTION: the mount, the dispatch loop and the post-dispose sweep all live
 * inside `body`, so no later edit can move a step out from under it. The old
 * shape — patch, mount, THEN open the try — left the global permanently replaced
 * whenever the view threw during build, which is precisely the failure mount mode
 * exists to catch, silently swallowing every later test's error output in the
 * same file (issue #69).
 *
 * Patching the global rather than injecting a sink is forced here: @llui/dom
 * reports binding/accessor errors through `console.error`, and its only sink —
 * `handle.setOnBindingError` — cannot be installed until `mountApp` has RETURNED,
 * i.e. after the build-time errors we most need to see.
 */
function withCapturedConsoleErrors<T>(body: (errs: string[]) => T): T {
  const errs: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    errs.push(args.join(' '))
  }
  try {
    return body(errs)
  } finally {
    console.error = original
  }
}

/**
 * Owns the mount for one run: mounts, runs `body`, then ALWAYS disposes. Every
 * failure branch in `body` returns early, so the teardown has to live in a
 * `finally` no branch can return past.
 *
 * `mountApp` cannot sit inside THIS try — a throw from the view build yields no
 * handle to dispose — but it does sit inside the caller's console-capture region,
 * which is the guarantee that was missing (issue #69).
 *
 * The harness registers NO subscriber of its own. A probe would be both a
 * perturbation (it flips the runtime's `subscribers.size > 0` fast path, so mount
 * mode would stop exercising the zero-subscriber commit path virtually every real
 * app runs) and an unfalsifiable detector: `dispose()` clears the subscriber set
 * AND `send`/`batch` return early once disposed, so no public call can reach a
 * listener afterwards and a "was a listener notified after dispose?" flag can
 * never be set. That contract is pinned directly, with a positive control, in
 * `test/property-test-cleanup.test.ts`; registering nothing is what makes it
 * impossible for a run to leave a subscriber behind.
 */
function withMountedRun<S, M, E, T>(
  container: HTMLElement,
  def: SignalComponentDef<S, M, E>,
  options: MountSignalOptions<S> | undefined,
  body: (handle: SignalComponentHandle<S, M>) => T,
): T {
  const handle = mountApp(container, def, options)
  try {
    return body(handle)
  } finally {
    handle.dispose()
  }
}

/**
 * Renders the post-dispose sweep as a human-readable report (callers only reach
 * it with a non-empty list). A timer still armed at dispose is the concrete shape
 * of "fires into a disposed handle": its callback outlives the mount and whatever
 * it sends lands on a torn-down component (dropped with a dev warning, at best).
 *
 * It is a SUSPICION, not a verdict — hence `LeakPolicy` and its warning default.
 * A one-shot that checks `signal.aborted` when it fires is armed at dispose and
 * still perfectly safe, and the timer may belong to a library the author cannot
 * change.
 */
function leakReport(pending: ReadonlyArray<PendingTimer>): string {
  return (
    `${pending.length} pending timer(s) at dispose():\n` +
    pending
      .map((t) => `  ${t.kind}(${t.delayMs}ms) scheduled at:\n${formatOrigin(t.origin)}`)
      .join('\n')
  )
}

/** Both report paths end with the same two ways out, one of which always applies. */
const LEAK_ADVICE =
  'Tie the timer to `api.signal` in `onEffect` if it is yours; if it belongs to a ' +
  "library, pass `mount: { leaks: 'off' }` to stop checking."

/**
 * A cheap identity for "this same leak again", used to warn once per call. It
 * deliberately does NOT read any stack: formatting one is the expensive half, and
 * a run that only repeats a leak already warned about must not pay for it. Counts
 * are excluded too — the same leaking call site arms a different number of timers
 * depending on how many messages the run happened to generate.
 */
function leakSignature(pending: ReadonlyArray<PendingTimer>): string {
  return [...new Set(pending.map((t) => `${t.kind}:${t.delayMs}`))].sort().join(',')
}

/**
 * Mount-mode run. The mounted component IS the system under test: we drive it
 * with `handle.send`, then OBSERVE it (state read back via `handle.getState`,
 * effects collected from the component's own `onEffect`). We do NOT run a
 * parallel `def.update` — a shadow reduction would diverge from the mounted
 * state for any non-deterministic/side-effecting reducer, so `next` generates
 * from the real mounted state and the reducer runs exactly once per message.
 * Captures `console.error` so accessor throws bubble up as failures, and sweeps
 * for resources the run left behind after `dispose()` (see `LeakPolicy`).
 */
function runMount<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  config: PropertyTestConfig<S, M, E>,
  next: NextMsg<S, M>,
  warnLeak: (signature: string, render: () => string) => void,
): RunResult<M> {
  const mount = config.mount!
  const leaks: LeakPolicy = mount.leaks ?? 'warn'
  const msgs: Array<StepMsg<M>> = []

  // Every global this run borrows — the console sink, the timer schedulers — and
  // the mount itself is installed by a combinator whose `finally` encloses the
  // ENTIRE run. The nesting IS the guarantee: there is no place left to write a
  // step of the run that a restore or a dispose can be skipped past (issue #69).
  return withTimerTracking(leaks !== 'off', (timers) =>
    withCapturedConsoleErrors((errs) => {
      const container = (mount.container ?? (() => document.createElement('div')))()

      let stepEffects: E[] = []
      const collectingDef: SignalComponentDef<S, M, E> = {
        ...def,
        onEffect: (effect: E, api) => {
          stepEffects.push(effect)
          return def.onEffect?.(effect, api)
        },
      }

      const result = withMountedRun(
        container,
        collectingDef,
        mount.options,
        (handle): RunResult<M> => {
          // A binding accessor can throw at MOUNT time (before any message),
          // surfacing as a console.error inside `mountApp`. Check the capture
          // immediately — the init-invariant check below reads state and would
          // otherwise mask it.
          if (errs.length > 0) {
            return {
              failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` },
              msgs,
            }
          }
          let curState = handle.getState()
          const initFail = checkInvariants(config.invariants, curState, stepEffects)
          if (initFail) return { failure: initFail, msgs }

          for (let i = 0; ; i++) {
            const step = next(curState, i)
            if (!step) break
            msgs.push(step)

            stepEffects = []
            try {
              handle.send(step.msg)
              handle.flush()
            } catch (e) {
              const err = e instanceof Error ? e : new Error(String(e))
              return {
                failure: {
                  kind: 'commit-throw',
                  detail: `Last msg: ${JSON.stringify(step.msg)}\nOriginal error: ${err.message}${
                    err.stack ? `\n${err.stack}` : ''
                  }`,
                },
                msgs,
              }
            }

            curState = handle.getState()
            const invFail = checkInvariants(config.invariants, curState, stepEffects)
            if (invFail) return { failure: invFail, msgs }

            if (mount.assertDom) {
              let ok: boolean | void
              try {
                ok = mount.assertDom(curState, container)
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e))
                return { failure: { kind: 'assert-dom-throw', detail: err.message }, msgs }
              }
              if (ok === false) {
                return {
                  failure: { kind: 'assert-dom', detail: `State: ${JSON.stringify(curState)}` },
                  msgs,
                }
              }
            }

            if (errs.length > 0) {
              return {
                failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` },
                msgs,
              }
            }
          }
          // Final sweep before declaring success: a console.error can fire during
          // a commit whose message emitted no state change (so the per-step check
          // above ran, but an async/deferred binding error could still have
          // landed) — catch it here so a mount-time or trailing error is never
          // missed.
          if (errs.length > 0) {
            return {
              failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` },
              msgs,
            }
          }
          return { failure: null, msgs }
        },
      )

      // Post-dispose sweep, read only once the mount is torn down. A run that
      // already failed reports THAT: a leak on an aborted run is usually a
      // consequence of stopping early, not an independent defect.
      if (result.failure || leaks === 'off') return result
      const pending = timers.pending()
      if (pending.length === 0) return result
      if (leaks === 'warn') {
        // `console.warn` is untouched by the capture above, so this reaches the
        // real console. The caller de-duplicates: one report per propertyTest
        // call, not one per run and shrink replay — and the text (with its stack
        // formatting) is rendered only for the report that is actually printed.
        warnLeak(leakSignature(pending), () => leakReport(pending))
        return result
      }
      return { failure: { kind: 'leak', detail: `${leakReport(pending)}\n${LEAK_ADVICE}` }, msgs }
    }),
  )
}

/** A `NextMsg` that replays a fixed recorded list, ignoring state. */
function replayNext<S, M>(list: ReadonlyArray<StepMsg<M>>): NextMsg<S, M> {
  return (_state, i) => (i < list.length ? list[i]! : null)
}

/**
 * Delta-debugging shrink: greedily remove message-list elements while the same
 * failure still reproduces, until no single removal helps (1-minimal). Repeats
 * passes because removing one element can make another removable. `reproduces`
 * replays a candidate and returns the failure it produced (or null); a
 * candidate counts only if it reproduces the *same* failure kind/index.
 */
function shrink<M>(
  msgs: ReadonlyArray<StepMsg<M>>,
  target: Failure,
  reproduces: (candidate: ReadonlyArray<StepMsg<M>>) => Failure | null,
): Array<StepMsg<M>> {
  let current = msgs.slice()
  let changed = true
  while (changed && current.length > 1) {
    changed = false
    for (let i = current.length - 1; i >= 0; i--) {
      const candidate = current.slice(0, i).concat(current.slice(i + 1))
      const f = reproduces(candidate)
      if (f && sameFailure(f, target)) {
        current = candidate
        changed = true
        if (current.length <= 1) break
      }
    }
  }
  return current
}

function formatAndThrow<M>(
  mode: 'reducer' | 'mount',
  failure: Failure,
  minimal: ReadonlyArray<StepMsg<M>>,
  seed: number,
): never {
  const seqStr = minimal.map((s) => s.name).join(' → ')
  // Full JSON of the minimal failing message payloads so the failure can be
  // inspected + hand-replayed, not just read as generator names.
  const payloads = JSON.stringify(
    minimal.map((s) => s.msg),
    null,
    2,
  )
  const prefix = mode === 'mount' ? 'propertyTest(mount)' : 'propertyTest'
  let headline: string
  switch (failure.kind) {
    case 'invariant':
      headline = `invariant ${failure.invariantIndex} violated`
      break
    case 'commit-throw':
      headline = 'commit threw'
      break
    case 'assert-dom':
      headline = 'assertDom returned false'
      break
    case 'assert-dom-throw':
      headline = 'assertDom threw'
      break
    case 'console-error':
      headline = 'console.error during commit'
      break
    case 'leak':
      headline = 'the run leaked a resource past dispose()'
      break
  }
  throw new Error(
    `${prefix}: ${headline} after sequence: [${seqStr}]\n` +
      `Seed: ${seed} (pass \`seed: ${seed}\` to replay this run)\n` +
      `Minimal failing messages: ${payloads}\n` +
      `${failure.detail}`,
  )
}

export function propertyTest<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  config: PropertyTestConfig<S, M, E>,
): void {
  const runs = config.runs ?? 1000
  const maxLen = config.maxSequenceLength ?? 50
  const genNames = Object.keys(config.messageGenerators)

  if (genNames.length === 0) {
    throw new Error('propertyTest: at least one message generator required')
  }

  const mode: 'reducer' | 'mount' = config.mount ? 'mount' : 'reducer'

  // One leak report per CALL under `leaks: 'warn'`. The same leak reappears in
  // every run and every shrink replay, so reporting per run would bury a
  // `runs: 1000` suite under a thousand identical warnings.
  const warnedLeaks = new Set<string>()
  const warnLeak = (signature: string, render: () => string): void => {
    if (warnedLeaks.has(signature)) return
    warnedLeaks.add(signature)
    console.warn(
      `propertyTest(mount): the run may have leaked a resource past dispose().\n${render()}\n` +
        `${LEAK_ADVICE} Pass \`mount: { leaks: 'error' }\` to fail the run on this instead.`,
    )
  }
  const run = (
    d: SignalComponentDef<S, M, E>,
    c: PropertyTestConfig<S, M, E>,
    n: NextMsg<S, M>,
  ): RunResult<M> => (mode === 'mount' ? runMount(d, c, n, warnLeak) : runReducer(d, c, n))

  // One seeded PRNG drives sequence lengths + generator selection for the WHOLE
  // call, so a printed seed replays every run identically (and thus the exact
  // failing run). Omitting `config.seed` picks a fresh random seed per call.
  const seed = config.seed ?? randomSeed()
  const rng = mulberry32(seed)

  for (let r = 0; r < runs; r++) {
    const seqLen = 1 + rng.int(maxLen)

    // Generation: pick a random generator each step and build its message from
    // the live current state. Bounded to `seqLen` steps.
    const generate: NextMsg<S, M> = (state, i) => {
      if (i >= seqLen) return null
      const genName = genNames[rng.int(genNames.length)]!
      const gen = config.messageGenerators[genName]!
      const msg = gen.length === 0 ? (gen as () => M)() : (gen as (s: S) => M)(state)
      return { name: genName, msg }
    }

    const { failure, msgs } = run(def, config, generate)
    if (!failure) continue

    // Reproduce-and-shrink: replay the recorded messages, keeping only the ones
    // needed to still trigger the same failure.
    const minimal = shrink(
      msgs,
      failure,
      (candidate) => run(def, config, replayNext(candidate)).failure,
    )
    formatAndThrow(mode, failure, minimal, seed)
  }
}
