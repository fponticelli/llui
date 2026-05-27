// Current dirty mask — set by the update loop during Phase 2.
// Split into two words for the multi-word `__prefixes` path: bits 0..30
// in `currentDirtyMask`, bits 31..61 in `currentDirtyMaskHi`. For ≤31-
// prefix components the high word stays 0 — gates collapse to the
// single-word check under V8's inline caches.
let currentDirtyMask = 0
let currentDirtyMaskHi = 0

export function setCurrentDirtyMask(mask: number, maskHi: number = 0): void {
  currentDirtyMask = mask
  currentDirtyMaskHi = maskHi
}

const UNSET = Symbol('unset')

const FULL_MASK = 0xffffffff | 0

export function memo<S, T>(accessor: (s: S) => T, mask?: number, maskHi?: number): (s: S) => T {
  let lastInput: S | typeof UNSET = UNSET
  let lastOutput: T
  // Same gate-asymmetry footgun as createBinding / structural blocks.
  // If `mask` is FULL_MASK (the compiler's "fire on any state change"
  // signal) but `maskHi` is left unset, the Level 1 gate
  // `(mask & dirty) | (maskHi & dirtyHi)` silently drops high-word
  // changes — every memoization in a ≥32-prefix component would stay
  // cached forever for high-word-only updates. Mirror the FULL_MASK
  // intent into the high word when the caller didn't speak for it.
  const effectiveMaskHi = maskHi ?? (mask === FULL_MASK ? FULL_MASK : 0)

  return (s: S) => {
    // Level 1: bitmask fast path — skip if neither low nor high masks overlap
    if (
      lastInput !== UNSET &&
      mask !== undefined &&
      !((mask & currentDirtyMask) | (effectiveMaskHi & currentDirtyMaskHi))
    ) {
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
