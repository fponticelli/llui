// Shared structural comparison helpers for the test harness. One home for the
// three JSON-walk algorithms that used to be copy-pasted across replay-trace
// (`deepEqual`), agent-session (`simpleDiff`), and assert-effects
// (`partialMatch`). Keeping them together means the equality/diff/escape rules
// can't drift apart between call sites.

/** A JSON-Patch (RFC 6902 subset) operation: `add` / `remove` / `replace`. */
export type JsonPatchOp =
  | { op: 'add'; path: string; value?: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value?: unknown }

/**
 * Deep structural equality for JSON-serializable values. `Object.is` at the
 * leaves; arrays compared by length + element-wise; objects by key set +
 * per-key. Non-plain values (functions, class instances) fall through to
 * `Object.is` identity — the harness only ever compares JSON state/effects, so
 * that's the correct contract.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!jsonEqual(a[i], b[i])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false
    if (!jsonEqual(aObj[key], bObj[key])) return false
  }
  return true
}

/**
 * Partial deep match: does `actual` contain everything `expected` specifies?
 * `undefined` in `expected` matches anything (an unspecified field). Primitives
 * match by `===`.
 *
 * ARRAY SEMANTICS (explicit and documented): arrays match **by index with a
 * length check** — `expected` and `actual` must have the same `length`, and
 * each element is matched positionally (recursively, so a partial object at
 * index `i` still matches). An `expected` array is therefore a full positional
 * template, NOT a subset/subsequence: `[a]` does NOT match `[a, b]`. Use
 * `undefined` at a position to leave that element unconstrained.
 */
export function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return true
  if (actual === expected) return true
  if (expected === null || actual === null) return actual === expected
  if (typeof expected !== 'object' || typeof actual !== 'object') return false

  const expIsArr = Array.isArray(expected)
  const actIsArr = Array.isArray(actual)
  if (expIsArr !== actIsArr) return false

  if (expIsArr && actIsArr) {
    if (expected.length !== actual.length) return false
    for (let i = 0; i < expected.length; i++) {
      if (!partialMatch(actual[i], expected[i])) return false
    }
    return true
  }

  const expObj = expected as Record<string, unknown>
  const actObj = actual as Record<string, unknown>
  for (const key of Object.keys(expObj)) {
    if (!partialMatch(actObj[key], expObj[key])) return false
  }
  return true
}

/**
 * Structural diff of two JSON values in JSON-Patch shape (RFC 6902 subset). The
 * same positional/key-based walk `@llui/agent`'s `computeStateDiff` uses:
 * object keys diffed by name, arrays by index (excess removed from the end,
 * new elements added at their landing index). Path segments are JSON-Pointer
 * escaped (RFC 6901: `~` → `~0`, `/` → `~1`).
 */
export function jsonDiff(prev: unknown, next: unknown): JsonPatchOp[] {
  const ops: JsonPatchOp[] = []
  diffInto(prev, next, '', ops)
  return ops
}

function diffInto(prev: unknown, next: unknown, base: string, ops: JsonPatchOp[]): void {
  if (Object.is(prev, next)) return
  if (
    prev === null ||
    next === null ||
    prev === undefined ||
    next === undefined ||
    typeof prev !== 'object' ||
    typeof next !== 'object'
  ) {
    ops.push({ op: 'replace', path: base, value: next })
    return
  }
  const prevIsArr = Array.isArray(prev)
  const nextIsArr = Array.isArray(next)
  if (prevIsArr !== nextIsArr) {
    ops.push({ op: 'replace', path: base, value: next })
    return
  }
  if (prevIsArr && nextIsArr) {
    const minLen = Math.min(prev.length, next.length)
    for (let i = 0; i < minLen; i++) diffInto(prev[i], next[i], `${base}/${i}`, ops)
    if (prev.length > next.length) {
      for (let i = prev.length - 1; i >= next.length; i--) {
        ops.push({ op: 'remove', path: `${base}/${i}` })
      }
    }
    if (next.length > prev.length) {
      for (let i = prev.length; i < next.length; i++) {
        ops.push({ op: 'add', path: `${base}/${i}`, value: next[i] })
      }
    }
    return
  }
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>
  for (const k in a) {
    if (!(k in b)) ops.push({ op: 'remove', path: `${base}/${escapeSeg(k)}` })
  }
  for (const k in b) {
    const path = `${base}/${escapeSeg(k)}`
    if (!(k in a)) ops.push({ op: 'add', path, value: b[k] })
    else diffInto(a[k], b[k], path, ops)
  }
}

function escapeSeg(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}
