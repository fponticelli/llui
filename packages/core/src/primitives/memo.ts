export function memo<S, T>(accessor: (s: S) => T): (s: S) => T {
  let lastInput: S | typeof UNSET = UNSET
  let lastOutput: T

  return (s: S) => {
    if (lastInput !== UNSET && Object.is(s, lastInput)) {
      return lastOutput
    }
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

const UNSET = Symbol('unset')
