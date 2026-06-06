import type { SignalComponentDef } from '@llui/dom'
import { mountApp } from '@llui/dom'

/** Signal `init`/`update` may return a bare `S` or a `[S, E[]]` tuple. */
function normalize<S, E>(r: [S, E[]] | S): [S, E[]] {
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [S, E[]])[1])) {
    return r as [S, E[]]
  }
  return [r as S, []]
}

export interface PropertyTestConfig<S, M, E> {
  invariants: Array<(state: S, effects: E[]) => boolean>
  messageGenerators: Record<string, ((state: S) => M) | (() => M)>
  runs?: number
  maxSequenceLength?: number
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

  for (let run = 0; run < runs; run++) {
    const sequence: { name: string; msg: M }[] = []
    const seqLen = 1 + Math.floor(Math.random() * maxLen)

    if (config.mount) {
      // Mount mode — exercise the actual render/reconcile pipeline. The
      // mounted component IS the system under test: we drive it with
      // handle.send, then OBSERVE it (state read back via handle.getState,
      // effects collected from the component's own onEffect). We do NOT run a
      // parallel def.update — a shadow reduction would diverge from the mounted
      // state for any non-deterministic/side-effecting reducer, so invariants
      // and assertDom could disagree with the real DOM (false pass or fail).
      //
      // Captures console.error so accessor throws bubble up as test failures
      // instead of hiding in the test runner's noise.
      const errs: string[] = []
      const origError = console.error
      console.error = (...args: unknown[]) => {
        errs.push(args.join(' '))
      }
      const container = (config.mount.container ?? (() => document.createElement('div')))()

      // Collect the effects the mounted component actually emits (from init and
      // from each send), chaining to any real onEffect so its behavior is
      // preserved. `stepEffects` is reset per dispatch so invariants see only
      // the effects produced by that message.
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
        // Initial state + init effects from the real mount.
        let curState = handle.getState()
        checkInvariants(config.invariants, curState, stepEffects, sequence)

        for (let step = 0; step < seqLen; step++) {
          const genName = genNames[Math.floor(Math.random() * genNames.length)]!
          const gen = config.messageGenerators[genName]!
          // Generate from the mounted component's real current state.
          const msg = gen.length === 0 ? (gen as () => M)() : (gen as (s: S) => M)(curState)
          sequence.push({ name: genName, msg })

          stepEffects = []
          try {
            handle.send(msg)
            handle.flush()
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            const seqStr = sequence.map((s) => s.name).join(' → ')
            throw new Error(
              `propertyTest(mount): commit threw after sequence: [${seqStr}]\n` +
                `Last msg: ${JSON.stringify(msg)}\n` +
                `Original error: ${err.message}` +
                (err.stack ? `\n${err.stack}` : ''),
              { cause: e },
            )
          }

          // Observe the system under test: read state back, check the effects
          // it actually emitted.
          curState = handle.getState()
          checkInvariants(config.invariants, curState, stepEffects, sequence)

          if (config.mount.assertDom) {
            let ok: boolean | void
            try {
              ok = config.mount.assertDom(curState, container)
            } catch (e) {
              const err = e instanceof Error ? e : new Error(String(e))
              const seqStr = sequence.map((s) => s.name).join(' → ')
              throw new Error(
                `propertyTest(mount): assertDom threw after sequence: [${seqStr}]\n` +
                  `${err.message}`,
                { cause: e },
              )
            }
            if (ok === false) {
              const seqStr = sequence.map((s) => s.name).join(' → ')
              throw new Error(
                `propertyTest(mount): assertDom returned false after sequence: [${seqStr}]\n` +
                  `State: ${JSON.stringify(curState)}`,
              )
            }
          }

          if (errs.length > 0) {
            const seqStr = sequence.map((s) => s.name).join(' → ')
            throw new Error(
              `propertyTest(mount): console.error during commit after sequence: [${seqStr}]\n` +
                `Captured: ${errs.join('\n')}`,
            )
          }
        }
      } finally {
        handle.dispose()
        console.error = origError
      }
      continue
    }

    // Reducer-only mode (original behavior) — no DOM; the harness IS the
    // single source of truth, so a shadow reduction is correct here.
    const [initState, initEffects] = normalize(def.init())
    let state = initState
    checkInvariants(config.invariants, state, initEffects, sequence)

    for (let step = 0; step < seqLen; step++) {
      const genName = genNames[Math.floor(Math.random() * genNames.length)]!
      const gen = config.messageGenerators[genName]!
      const msg = gen.length === 0 ? (gen as () => M)() : (gen as (s: S) => M)(state)
      sequence.push({ name: genName, msg })

      const [newState, effects] = normalize(def.update(state, msg))
      state = newState

      checkInvariants(config.invariants, state, effects, sequence)
    }
  }
}

function checkInvariants<S, M, E>(
  invariants: Array<(state: S, effects: E[]) => boolean>,
  state: S,
  effects: E[],
  sequence: Array<{ name: string; msg: M }>,
): void {
  for (let i = 0; i < invariants.length; i++) {
    if (!invariants[i]!(state, effects)) {
      // Attempt to shrink
      const shrunk = shrinkSequence(sequence)
      const seqStr = shrunk.map((s) => s.name).join(' → ')
      throw new Error(
        `propertyTest: invariant ${i} violated after sequence: [${seqStr}]\n` +
          `State: ${JSON.stringify(state)}\n` +
          `Effects: ${JSON.stringify(effects)}`,
      )
    }
  }
}

function shrinkSequence<M>(
  sequence: Array<{ name: string; msg: M }>,
): Array<{ name: string; msg: M }> {
  // Simple shrinking: try removing each element from the end
  // A full implementation would do binary search shrinking
  // For now, just return the sequence as-is (no shrinking)
  return sequence
}
