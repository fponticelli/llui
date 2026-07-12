// A tiny deterministic PRNG (mulberry32) so `propertyTest` failures replay from
// a printed seed. mulberry32 is a well-known 32-bit generator: fast, no
// dependencies, good enough distribution for picking sequence lengths and
// generator names. NOT cryptographic — this is test fixture generation.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Integer in [0, bound) — `bound` must be a positive integer. */
  int(bound: number): number
}

/** Create a seeded RNG. Same seed ⇒ same stream, so a failing run replays. */
export function mulberry32(seed: number): Rng {
  // Force to a uint32 seed so callers can pass any finite number.
  let a = seed >>> 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(bound: number): number {
      return Math.floor(next() * bound)
    },
  }
}

/** A fresh random 32-bit seed for the default (unseeded) case. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0
}
