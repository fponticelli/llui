import type { ComponentDef } from '@llui/core'

export function propertyTest<S, M, E>(
  _def: ComponentDef<S, M, E>,
  _config: {
    invariants: Array<(state: S, effects: E[]) => boolean>
    messageGenerators: Record<string, ((state: S) => M) | (() => M)>
    runs?: number
    maxSequenceLength?: number
  },
): void {
  // TODO: implement generative testing
  throw new Error('propertyTest not yet implemented')
}
