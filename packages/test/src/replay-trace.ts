import type { ComponentDef } from '@llui/dom'

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
  def: ComponentDef<S, M, E>,
  trace: LluiTrace<S, M, E>,
): void {
  const [initState] = def.init()
  let state = initState

  for (let i = 0; i < trace.entries.length; i++) {
    const entry = trace.entries[i]!
    const [newState, effects] = def.update(state, entry.msg)

    // Compare state
    if (!deepEqual(newState, entry.expectedState)) {
      throw new Error(
        `replayTrace: state diverged at step ${i}\n` +
          `Message: ${JSON.stringify(entry.msg)}\n` +
          `Expected: ${JSON.stringify(entry.expectedState)}\n` +
          `Actual: ${JSON.stringify(newState)}`,
      )
    }

    // Compare effects
    if (!deepEqual(effects, entry.expectedEffects)) {
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!deepEqual(aObj[key], bObj[key])) return false
  }

  return true
}
