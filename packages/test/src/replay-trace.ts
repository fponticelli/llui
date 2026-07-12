import { normalizeUpdateResult, type SignalComponentDef } from '@llui/dom'
import { jsonEqual } from './internal/json.js'

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

export function replayTrace<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  trace: LluiTrace<S, M, E>,
): void {
  const [initState] = normalizeUpdateResult(def.init())
  let state = initState

  for (let i = 0; i < trace.entries.length; i++) {
    const entry = trace.entries[i]!
    const [newState, effects] = normalizeUpdateResult(def.update(state, entry.msg))

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

    state = newState
  }
}
