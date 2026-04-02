import type { ComponentDef } from '@llui/core'

export function propertyTest<S, M, E>(
  def: ComponentDef<S, M, E>,
  config: {
    invariants: Array<(state: S, effects: E[]) => boolean>
    messageGenerators: Record<string, ((state: S) => M) | (() => M)>
    runs?: number
    maxSequenceLength?: number
  },
): void {
  const runs = config.runs ?? 1000
  const maxLen = config.maxSequenceLength ?? 50
  const genNames = Object.keys(config.messageGenerators)

  if (genNames.length === 0) {
    throw new Error('propertyTest: at least one message generator required')
  }

  for (let run = 0; run < runs; run++) {
    const [initState, initEffects] = def.init()
    let state = initState
    const sequence: { name: string; msg: M }[] = []

    // Check invariants on initial state
    checkInvariants(config.invariants, state, initEffects, sequence)

    const seqLen = 1 + Math.floor(Math.random() * maxLen)

    for (let step = 0; step < seqLen; step++) {
      const genName = genNames[Math.floor(Math.random() * genNames.length)]!
      const gen = config.messageGenerators[genName]!
      const msg = gen.length === 0 ? (gen as () => M)() : (gen as (s: S) => M)(state)
      sequence.push({ name: genName, msg })

      const [newState, effects] = def.update(state, msg)
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

function shrinkSequence<M>(sequence: Array<{ name: string; msg: M }>): Array<{ name: string; msg: M }> {
  // Simple shrinking: try removing each element from the end
  // A full implementation would do binary search shrinking
  // For now, just return the sequence as-is (no shrinking)
  return sequence
}
