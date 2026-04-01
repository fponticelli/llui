import type { ComponentDef } from '@llui/core'

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
  _def: ComponentDef<S, M, E>,
  _trace: LluiTrace<S, M, E>,
): void {
  // TODO: implement trace replay
  throw new Error('replayTrace not yet implemented')
}
