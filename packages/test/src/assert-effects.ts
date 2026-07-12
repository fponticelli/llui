import { partialMatch } from './internal/json.js'

/**
 * Assert an effect list matches an expected list of partials. Length must be
 * equal; each effect at index `i` must partial-match `expected[i]`. See
 * {@link partialMatch} for the deep/array semantics (nested arrays match by
 * index with a length check; `undefined` fields are wildcards).
 */
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
