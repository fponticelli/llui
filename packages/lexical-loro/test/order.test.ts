/**
 * The fractional-index allocator.
 *
 * These tests are the specification for `src/order.ts`. Several of them encode
 * constraints that a spike MEASURED and that a later contributor would
 * otherwise "optimize" away — in particular the jitter policy (per batch, never
 * per insert) and the refusal to rebalance. Read the comments before relaxing
 * an assertion.
 */

import { describe, expect, it } from 'vitest'

import { DIGITS, allocate, allocateAt, between, comparePositions, jitterFor } from '../src/order.js'

describe('between', () => {
  it('returns a key strictly inside an unbounded interval', () => {
    const key = between(null, null)
    expect(key.length).toBe(1)
    expect(DIGITS.includes(key)).toBe(true)
  })

  it('orders strictly between both bounds', () => {
    for (const [a, b] of [
      ['a', 'b'],
      ['a', 'z'],
      [null, 'a'],
      ['z', null],
      ['aa', 'ab'],
      ['a', 'aa'],
    ] as const) {
      const key = between(a, b)
      if (a !== null) expect(key > a).toBe(true)
      if (b !== null) expect(key < b).toBe(true)
    }
  })

  it('subdivides indefinitely without ever colliding', () => {
    let low = 'a'
    const high = 'b'
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const key = between(low, high)
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(key > low).toBe(true)
      expect(key < high).toBe(true)
      low = key
    }
  })
})

describe('allocate', () => {
  it('returns nothing for a non-positive count', () => {
    expect(allocate(null, null, 0, null)).toEqual([])
    expect(allocate(null, null, -1, null)).toEqual([])
  })

  it('returns strictly increasing keys inside the interval', () => {
    for (const jitter of [null, jitterFor(1n)]) {
      const keys = allocate('a', 'b', 5, jitter)
      expect(keys.length).toBe(5)
      for (let i = 0; i < keys.length; i++) {
        expect(keys[i]! > 'a').toBe(true)
        expect(keys[i]! < 'b').toBe(true)
        if (i > 0) expect(keys[i]! > keys[i - 1]!).toBe(true)
      }
    }
  })

  it('stays inside a half-open interval on both sides', () => {
    for (const jitter of [null, jitterFor(3n)]) {
      for (const keys of [allocate(null, 'm', 4, jitter), allocate('m', null, 4, jitter)]) {
        for (let i = 1; i < keys.length; i++) expect(keys[i]! > keys[i - 1]!).toBe(true)
      }
      expect(allocate(null, 'm', 4, jitter).every((key) => key < 'm')).toBe(true)
      expect(allocate('m', null, 4, jitter).every((key) => key > 'm')).toBe(true)
    }
  })

  /**
   * CONSTRAINT 1 — batch allocation confines a paste to a peer-private
   * sub-interval, so two peers pasting at the same spot cannot interleave.
   *
   * Without it, both peers generate the SAME keys in the same gap and the uuid
   * tiebreak alternates them: two 5-paragraph pastes render as a 10-paragraph
   * A/B/A/B alternation. Convergent, and nonsense.
   */
  it('confines two peers’ batches to disjoint sub-intervals', () => {
    const a = allocate('a', 'b', 5, jitterFor(1n))
    const b = allocate('a', 'b', 5, jitterFor(2n))
    const allA = a.every((key) => b.every((other) => key < other))
    const allB = b.every((key) => a.every((other) => key < other))
    // Disjoint: one batch sorts entirely before the other, with no interleaving.
    expect(allA || allB).toBe(true)
  })

  it('interleaves pairwise WITHOUT jitter — the defect jitter exists to fix', () => {
    const a = allocate('a', 'b', 5, null)
    const b = allocate('a', 'b', 5, null)
    // Identical keys: rendering order then falls to the uuid tiebreak, which
    // alternates the two pastes.
    expect(a).toEqual(b)
  })

  /**
   * CONSTRAINT 2 — jitter applies PER BATCH (count > 1), never per insert.
   *
   * A single insert must ignore the jitter digit entirely. Always-on jitter
   * degrades key growth from ~0.2 to ~1.0 characters per insert, and WHICH
   * digit is pathological depends on the direction of travel, so no fixed
   * per-peer digit is safe both ways. The measurement itself — including what
   * the degraded curve costs — lives in `test/constraints.test.ts`.
   */
  it('ignores jitter for a single insert', () => {
    for (const peer of [1n, 7n, 40n]) {
      expect(allocate('a', 'b', 1, jitterFor(peer))).toEqual(allocate('a', 'b', 1, null))
    }
  })

  it('keeps single-insert growth linear and shallow in both directions', () => {
    const leftward = (count: number): number => {
      let after = 'z'
      for (let i = 0; i < count; i++) after = allocate('a', after, 1, jitterFor(1n))[0]!
      return after.length
    }
    const rightward = (count: number): number => {
      let before = 'a'
      for (let i = 0; i < count; i++) before = allocate(before, 'z', 1, jitterFor(1n))[0]!
      return before.length
    }
    // ~1 character per 5 inserts. These are the NO-jitter figures, which is the
    // point: routing single inserts around the jitter is what preserves them.
    expect(leftward(2000)).toBe(401)
    expect(rightward(2000)).toBe(334)
  })
})

describe('allocateAt', () => {
  it('allocates at the front, the middle and the end of a sibling list', () => {
    const positions = ['b', 'd', 'f']
    expect(allocateAt(positions, 0, 1, null)[0]! < 'b').toBe(true)
    const middle = allocateAt(positions, 1, 1, null)[0]!
    expect(middle > 'b' && middle < 'd').toBe(true)
    expect(allocateAt(positions, 3, 1, null)[0]! > 'f').toBe(true)
  })

  it('allocates a contiguous batch between two siblings', () => {
    const keys = allocateAt(['b', 'd'], 1, 3, jitterFor(1n))
    expect(keys.length).toBe(3)
    for (const key of keys) expect(key > 'b' && key < 'd').toBe(true)
    expect([...keys].sort()).toEqual(keys)
  })

  /**
   * CONSTRAINT 4 — EQUAL positions are reachable, and the uuid tiebreak only
   * resolves RENDERING. Two peers inserting at the same slot mint an IDENTICAL
   * `pos`; no key exists strictly between two equal keys.
   *
   * `allocateAt` must never emit a key that breaks the sort invariant. It
   * widens past the whole equal-pos group instead, so the new child lands after
   * it rather than at an arbitrary place. That is a documented one-slot-late
   * degradation in a rare degenerate case — the alternative (`between` on two
   * equal keys) returns a key that sorts AFTER BOTH while claiming to sort
   * between them, which is silent corruption of the ordering invariant.
   */
  it('widens past an equal-pos group instead of violating the sort invariant', () => {
    const positions = ['b', 'd', 'd', 'f']
    const key = allocateAt(positions, 2, 1, null)[0]!
    expect(key > 'd').toBe(true)
    expect(key < 'f').toBe(true)
  })

  it('widens to unbounded when the equal group runs to the end', () => {
    const key = allocateAt(['d', 'd'], 1, 1, null)[0]!
    expect(key > 'd').toBe(true)
  })

  it('keeps a batch strictly ordered when widening past an equal group', () => {
    const keys = allocateAt(['d', 'd', 'f'], 1, 3, jitterFor(2n))
    for (const key of keys) expect(key > 'd' && key < 'f').toBe(true)
    for (let i = 1; i < keys.length; i++) expect(keys[i]! > keys[i - 1]!).toBe(true)
  })
})

describe('jitterFor', () => {
  it('is stable per peer and spread across peers', () => {
    expect(jitterFor(7n)).toBe(jitterFor(7n))
    const digits = new Set([1n, 2n, 3n, 4n, 5n].map(jitterFor))
    expect(digits.size).toBe(5)
  })

  it('handles a full 64-bit Loro peer id', () => {
    const digit = jitterFor(18446744073709551615n)
    expect(digit.length).toBe(1)
    expect(DIGITS.includes(digit)).toBe(true)
  })

  it('never returns the lowest digit, which would be a no-op suffix', () => {
    for (let peer = 0n; peer < 80n; peer++) expect(jitterFor(peer)).not.toBe(DIGITS[0])
  })
})

describe('comparePositions', () => {
  it('orders by pos, then by uuid', () => {
    expect(comparePositions('a', 'x', 'b', 'a')).toBeLessThan(0)
    expect(comparePositions('a', 'a', 'a', 'b')).toBeLessThan(0)
    expect(comparePositions('a', 'b', 'a', 'a')).toBeGreaterThan(0)
    expect(comparePositions('a', 'a', 'a', 'a')).toBe(0)
  })

  it('is a total order, so every peer renders the same sequence', () => {
    const entries = [
      { pos: 'b', uuid: '2' },
      { pos: 'a', uuid: '9' },
      { pos: 'b', uuid: '1' },
      { pos: 'a', uuid: '3' },
    ]
    const sorted = [...entries]
      .sort((x, y) => comparePositions(x.pos, x.uuid, y.pos, y.uuid))
      .map((entry) => entry.uuid)
    const reversed = [...entries]
      .reverse()
      .sort((x, y) => comparePositions(x.pos, x.uuid, y.pos, y.uuid))
      .map((entry) => entry.uuid)
    expect(sorted).toEqual(['3', '9', '1', '2'])
    expect(reversed).toEqual(sorted)
  })
})
