import { partialMatch, type PartialMatchOptions } from './internal/json.js'

/** Options for {@link assertEffects}. */
export interface AssertEffectsOptions {
  /**
   * Opt in to EXACT matching: each effect may carry no data key beyond those
   * its expectation names, at every level the expectation reaches. Keys whose
   * value is a function or `undefined` are exempt — they are outside the JSON
   * projection of the effect (an http effect's `onSuccess` callback is a fresh
   * closure every `update()` and cannot be written in an expected literal).
   *
   * Defaults to `false`: ignoring unspecified keys is what partial matching
   * MEANS, and every existing expectation relies on it. Exact mode is also how
   * you assert a key is ABSENT — name the keys that must exist and nothing
   * else — since `{ key: undefined }` asserts the opposite (present, holding
   * `undefined`).
   *
   * The handling of `undefined` is asymmetric on purpose: an EXTRA
   * `undefined`-valued key on the effect is tolerated (it is not data), while
   * an `undefined` you WRITE in the expectation still demands the key be there.
   */
  readonly exact?: boolean
}

/**
 * Assert an effect list matches an expected list of partials. Length must be
 * equal; each effect at index `i` must partial-match `expected[i]`. See
 * {@link partialMatch} for the deep/array semantics (nested arrays match by
 * index with a length check; an expected `undefined` asserts the actual value
 * IS `undefined` — leave a field unconstrained by omitting its key, not by
 * writing `undefined`).
 */
export function assertEffects<E>(
  actual: E[],
  expected: Array<Partial<E>>,
  options: AssertEffectsOptions = {},
): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `Expected ${expected.length} effects, got ${actual.length}.\nActual: ${format(actual)}`,
    )
  }

  const { exact = false } = options
  const matchOptions: PartialMatchOptions = { exact }

  for (let i = 0; i < expected.length; i++) {
    const act = actual[i]
    const exp = expected[i]
    if (!partialMatch(act, exp, matchOptions)) {
      throw new Error(
        `Effect at index ${i} does not match.\n` +
          `Expected (${exact ? 'exact' : 'partial'}): ${format(exp)}\n` +
          `Actual: ${format(act)}`,
      )
    }
  }
}

/**
 * `JSON.stringify` DROPS keys holding `undefined`, which would hide the one
 * field a failing `{ url: undefined }` expectation is about — and would render
 * an absent key and a present-but-undefined one identically, exactly the
 * distinction this assertion makes. Render those keys explicitly instead.
 */
function format(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v === undefined ? '<undefined>' : v), 2)
}
