import { createTeaDriver, normalizeUpdateResult, type SignalComponentDef } from '@llui/dom'
import { jsonEqual } from './internal/json.js'

/** The only trace-format version this replayer understands. Recorded by
 * `__lluiDebug.exportTrace()` (`@llui/dom` devtools) and by the MCP replay-test
 * generator; all three must agree, so bumping it is a breaking change. */
export const SUPPORTED_TRACE_VERSION = 1

export interface LluiTrace<S, M, E> {
  lluiTrace: 1
  component: string
  generatedBy: string
  timestamp: string
  entries: Array<{
    msg: M
    expectedState: S
    expectedEffects: E[]
  }>
}

/**
 * What {@link replayTrace} actually accepts. A real trace arrives as parsed
 * JSON — exported from a devtools session, hand-edited, or produced by an older
 * tool — so neither the version nor the recording component's identity can be
 * assumed present or correct at the type level. Both are validated at runtime
 * before the first reducer call; a well-formed {@link LluiTrace} is assignable
 * here unchanged.
 */
export type ReplayableTrace<S, M, E> = Omit<LluiTrace<S, M, E>, 'lluiTrace' | 'component'> & {
  lluiTrace?: number
  component?: string
}

/**
 * Replay a recorded message trace against a component definition, asserting the
 * state and effects at every step.
 *
 * The trace's version and recording component are validated FIRST — before
 * `init()` and the first `update()` — so a mismatched trace fails with a
 * version/identity error instead of a state diff that blames the reducer.
 *
 * An absent `component` field is accepted with a warning rather than rejected:
 * traces predate the field and hand-written ones legitimately omit it, so
 * rejecting would break working traces to buy nothing. The warning is what
 * makes the unverified identity visible; only a `component` that is present and
 * DIFFERENT is an error.
 */
export function replayTrace<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  trace: ReplayableTrace<S, M, E>,
): void {
  assertTraceMatches(def, trace)

  const [initState] = normalizeUpdateResult(def.init())
  let effects: E[] = []
  const driver = createTeaDriver(
    { init: () => initState, update: def.update },
    { onTransition: (transition) => (effects = transition.effects) },
  )

  for (let i = 0; i < trace.entries.length; i++) {
    const entry = trace.entries[i]!
    driver.send(entry.msg)
    const newState = driver.getState()

    // Compare state
    if (!jsonEqual(newState, entry.expectedState)) {
      throw new Error(
        `replayTrace: state diverged at step ${i}\n` +
          `Message: ${JSON.stringify(entry.msg)}\n` +
          `Expected: ${JSON.stringify(entry.expectedState)}\n` +
          `Actual: ${JSON.stringify(newState)}`,
      )
    }

    // Compare effects
    if (!jsonEqual(effects, entry.expectedEffects)) {
      throw new Error(
        `replayTrace: effects diverged at step ${i}\n` +
          `Message: ${JSON.stringify(entry.msg)}\n` +
          `Expected effects: ${JSON.stringify(entry.expectedEffects)}\n` +
          `Actual effects: ${JSON.stringify(effects)}`,
      )
    }
  }
}

/**
 * Throw if the trace cannot be replayed against `def` at all. Must run before
 * any reducer call: past this point every failure is reported as a state/effect
 * divergence, which points the reader at their own `update()` instead of at the
 * trace they fed in.
 */
function assertTraceMatches<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  trace: ReplayableTrace<S, M, E>,
): void {
  const version = trace.lluiTrace
  if (version !== SUPPORTED_TRACE_VERSION) {
    throw new Error(
      `replayTrace: unsupported trace version ${version ?? 'none'} — ` +
        `this replayer supports version ${SUPPORTED_TRACE_VERSION}. ` +
        `Re-export the trace with a matching @llui/dom devtools build.`,
    )
  }

  const recorded = trace.component
  if (recorded === undefined) {
    // Accepted, not rejected — see the note on `replayTrace`.
    console.warn(
      `replayTrace: trace has no \`component\` field, so it cannot be checked ` +
        `against ${describeDef(def)}. Replaying anyway — a state divergence below ` +
        `may mean the trace was recorded from a different component.`,
    )
    return
  }

  // `name` is optional on a component def, so an unnamed def has no identity to
  // mismatch against: warn (the trace may well be someone else's) but replay.
  if (def.name === undefined) {
    console.warn(
      `replayTrace: trace was recorded from component "${recorded}", but the ` +
        `definition under replay has no \`name\` to check it against. Replaying anyway.`,
    )
    return
  }

  if (def.name !== recorded) {
    throw new Error(
      `replayTrace: component mismatch — trace was recorded from component ` +
        `"${recorded}" but is being replayed against "${def.name}". ` +
        `Replay the trace against the component it came from.`,
    )
  }
}

/** Name a definition for a message, falling back when it is anonymous. */
function describeDef<S, M, E>(def: SignalComponentDef<S, M, E>): string {
  return def.name === undefined ? 'the component under replay' : `"${def.name}"`
}
