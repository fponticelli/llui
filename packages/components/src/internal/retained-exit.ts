/**
 * Reconcile presentation-only exit retention against a controlled/open value.
 *
 * The semantic value changes immediately. When animation is explicitly
 * enabled, values that just left remain in `exiting` until their own end event;
 * values that re-enter are removed immediately. Disabled/default animation can
 * never hang because retention is empty unless the caller opted in.
 */
export interface RetainedExitGeneration<T> {
  readonly value: T
  readonly generation: number
}

export function retainedExitGeneration<T>(
  generations: readonly RetainedExitGeneration<T>[],
  value: T,
): number | undefined {
  return generations.find((entry) => Object.is(entry.value, value))?.generation
}

export function retainedExits<T>(
  previous: readonly T[],
  next: readonly T[],
  exiting: readonly T[],
  generations: readonly RetainedExitGeneration<T>[],
  sequence: number,
  animated: boolean,
): {
  exiting: T[]
  generations: RetainedExitGeneration<T>[]
  sequence: number
} {
  if (!animated) return { exiting: [], generations: [], sequence }
  const nextValues = new Set(next)
  const departing = new Set(previous.filter((value) => !nextValues.has(value)))
  const retained = [...new Set([...previous, ...exiting])].filter((value) => !nextValues.has(value))
  const updatedGenerations: RetainedExitGeneration<T>[] = []
  let updatedSequence = sequence
  for (const value of retained) {
    if (departing.has(value)) {
      updatedSequence += 1
      updatedGenerations.push({ value, generation: updatedSequence })
      continue
    }
    const generation = retainedExitGeneration(generations, value)
    if (generation !== undefined) updatedGenerations.push({ value, generation })
  }
  return {
    exiting: retained,
    generations: updatedGenerations,
    sequence: updatedSequence,
  }
}

/** Single-surface form of {@link retainedExits}. */
export function retainedExit(
  previous: boolean,
  next: boolean,
  exiting: boolean,
  generation: number,
  animated: boolean,
): { exiting: boolean; generation: number } {
  return {
    exiting: animated && !next && (previous || exiting),
    generation: animated && previous && !next ? generation + 1 : generation,
  }
}
