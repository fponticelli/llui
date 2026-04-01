export function assertEffects<E>(actual: E[], expected: Array<Partial<E>>): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `Expected ${expected.length} effects, got ${actual.length}.\n` +
        `Actual: ${JSON.stringify(actual, null, 2)}`,
    )
  }

  for (let i = 0; i < expected.length; i++) {
    const act = actual[i]
    const exp = expected[i]
    if (!partialMatch(act, exp)) {
      throw new Error(
        `Effect at index ${i} does not match.\n` +
          `Expected (partial): ${JSON.stringify(exp, null, 2)}\n` +
          `Actual: ${JSON.stringify(act, null, 2)}`,
      )
    }
  }
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  if (actual === expected) return true
  if (expected === null || actual === null) return actual === expected

  if (typeof expected === 'object' && typeof actual === 'object') {
    const expObj = expected as Record<string, unknown>
    const actObj = actual as Record<string, unknown>
    for (const key of Object.keys(expObj)) {
      if (!partialMatch(actObj[key], expObj[key])) return false
    }
    return true
  }

  return false
}
