import { mountApp, normalizeUpdateResult, type SignalComponentDef } from '@llui/dom'
import { mulberry32, randomSeed } from './internal/prng.js'

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
   *     after each commit.
   *
   * `assertDom` runs in a try/catch — a throw inside it is rethrown
   * with the failing sequence appended, same as invariant failures.
   */
  mount?: {
    container?: () => HTMLElement
    assertDom?: (state: S, container: HTMLElement) => boolean | void
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
  kind: 'invariant' | 'commit-throw' | 'assert-dom' | 'assert-dom-throw' | 'console-error'
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
  let state = initState
  const first = checkInvariants(config.invariants, state, initEffects)
  if (first) return { failure: first, msgs }

  for (let i = 0; ; i++) {
    const step = next(state, i)
    if (!step) break
    msgs.push(step)
    const [nextState, effects] = normalizeUpdateResult(def.update(state, step.msg))
    state = nextState
    const f = checkInvariants(config.invariants, state, effects)
    if (f) return { failure: f, msgs }
  }
  return { failure: null, msgs }
}

/**
 * Mount-mode run. The mounted component IS the system under test: we drive it
 * with `handle.send`, then OBSERVE it (state read back via `handle.getState`,
 * effects collected from the component's own `onEffect`). We do NOT run a
 * parallel `def.update` — a shadow reduction would diverge from the mounted
 * state for any non-deterministic/side-effecting reducer, so `next` generates
 * from the real mounted state and the reducer runs exactly once per message.
 * Captures `console.error` so accessor throws bubble up as failures.
 */
function runMount<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  config: PropertyTestConfig<S, M, E>,
  next: NextMsg<S, M>,
): RunResult<M> {
  const mount = config.mount!
  const msgs: Array<StepMsg<M>> = []
  const errs: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => {
    errs.push(args.join(' '))
  }
  const container = (mount.container ?? (() => document.createElement('div')))()

  let stepEffects: E[] = []
  const collectingDef: SignalComponentDef<S, M, E> = {
    ...def,
    onEffect: (effect: E, api) => {
      stepEffects.push(effect)
      return def.onEffect?.(effect, api)
    },
  }
  const handle = mountApp(container, collectingDef)
  try {
    // A binding accessor can throw at MOUNT time (before any message), surfacing
    // as a console.error inside `mountApp`. Check the capture immediately — the
    // init-invariant check below reads state and would otherwise mask it.
    if (errs.length > 0) {
      return { failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` }, msgs }
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
        return { failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` }, msgs }
      }
    }
    // Final sweep before declaring success: a console.error can fire during a
    // commit whose message emitted no state change (so the per-step check above
    // ran, but an async/deferred binding error could still have landed) — catch
    // it here so a mount-time or trailing error is never missed.
    if (errs.length > 0) {
      return { failure: { kind: 'console-error', detail: `Captured: ${errs.join('\n')}` }, msgs }
    }
    return { failure: null, msgs }
  } finally {
    handle.dispose()
    console.error = origError
  }
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
  const run = mode === 'mount' ? runMount : runReducer

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
