// Current dirty mask — set by the update loop during Phase 2
let currentDirtyMask = 0

export function setCurrentDirtyMask(mask: number): void {
  currentDirtyMask = mask
}

const UNSET = Symbol('unset')

export function memo<S, T>(accessor: (s: S) => T, mask?: number): (s: S) => T {
  let lastInput: S | typeof UNSET = UNSET
  let lastOutput: T

  return (s: S) => {
    // Level 1: bitmask fast path — skip if dirty mask doesn't overlap
    if (lastInput !== UNSET && mask !== undefined && (mask & currentDirtyMask) === 0) {
      return lastOutput
    }

    // Same state reference — skip
    if (lastInput !== UNSET && Object.is(s, lastInput)) {
      return lastOutput
    }

    // Level 2: output stability — re-evaluate but return cached if same result
    const result = accessor(s)
    if (lastInput !== UNSET && Object.is(result, lastOutput)) {
      lastInput = s
      return lastOutput
    }

    lastInput = s
    lastOutput = result
    return result
  }
}
