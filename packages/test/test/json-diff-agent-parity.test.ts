import { describe, it, expect } from 'vitest'
import { jsonDiff } from '../src/internal/json'
import { mulberry32, randomSeed, type Rng } from '../src/internal/prng'
// `@llui/agent/protocol` re-exports the runtime's own `computeStateDiff`. The
// test harness's `jsonDiff` (src/internal/json.ts) must stay bit-for-bit
// identical to it: the agent surface reports state changes to LLMs using
// `computeStateDiff`, and the harness's assertions/replay diffs must agree with
// what the agent would report, or a passing test could mask an agent-visible
// change (and vice-versa). This closes the deferral the test-package agent
// flagged. (No dependency cycle: @llui/agent does not depend on @llui/test.)
import { computeStateDiff } from '@llui/agent/protocol'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

// A deliberately SMALL key space so `prev`/`next` objects overlap — that's what
// exercises the add / remove / replace branches (disjoint key sets would only
// ever add-then-remove). Some keys carry `/` and `~` to exercise JSON-Pointer
// segment escaping parity.
const KEYS = ['a', 'b', 'c', 'id', 'name', 'x/y', 'z~w']
const STRINGS = ['', 's', 'val', 'a/b', 'c~d', 'nested']

function randomKey(rng: Rng): string {
  return KEYS[rng.int(KEYS.length)]!
}

function randomJson(rng: Rng, depth: number): Json {
  const canNest = depth > 0
  const kind = canNest ? rng.int(6) : rng.int(4)
  switch (kind) {
    case 0:
      return null
    case 1:
      return rng.next() < 0.5
    case 2:
      return rng.int(6) - 2 // small ints, -2..3
    case 3:
      return STRINGS[rng.int(STRINGS.length)]!
    case 4: {
      const n = rng.int(4)
      const arr: Json[] = []
      for (let i = 0; i < n; i++) arr.push(randomJson(rng, depth - 1))
      return arr
    }
    default: {
      const n = rng.int(4)
      const obj: Record<string, Json> = {}
      for (let i = 0; i < n; i++) obj[randomKey(rng)] = randomJson(rng, depth - 1)
      return obj
    }
  }
}

// Derive `next` from `value` so most diffs are non-trivial and localized:
// tweak some fields, add/remove keys, grow/shrink arrays, occasionally replace
// wholesale. Never mutates the input (containers are copied), so unchanged
// subtrees stay reference-shared with `prev` — which also exercises the
// `Object.is` fast-path both diffs take.
function mutate(rng: Rng, value: Json, depth: number): Json {
  if (rng.next() < 0.25) return randomJson(rng, depth) // wholesale replace

  if (Array.isArray(value)) {
    const arr = value.slice()
    const op = rng.int(3)
    if (op === 0 && arr.length > 0) arr.pop()
    else if (op === 1) arr.push(randomJson(rng, depth - 1))
    for (let i = 0; i < arr.length; i++) {
      if (rng.next() < 0.4) arr[i] = mutate(rng, arr[i]!, depth - 1)
    }
    return arr
  }

  if (value !== null && typeof value === 'object') {
    const obj: Record<string, Json> = { ...value }
    const keys = Object.keys(obj)
    if (keys.length > 0 && rng.next() < 0.3) delete obj[keys[rng.int(keys.length)]!]
    if (rng.next() < 0.3) obj[randomKey(rng)] = randomJson(rng, depth - 1)
    for (const k of Object.keys(obj)) {
      if (rng.next() < 0.4) obj[k] = mutate(rng, obj[k]!, depth - 1)
    }
    return obj
  }

  return randomJson(rng, depth) // primitive → some new value
}

describe('jsonDiff ↔ @llui/agent computeStateDiff parity', () => {
  it('produces the same op list as computeStateDiff over random JSON state pairs', () => {
    const RUNS = 400
    const masterSeed = randomSeed()
    const rng = mulberry32(masterSeed)

    for (let run = 0; run < RUNS; run++) {
      const prev = randomJson(rng, 4)
      const next = rng.next() < 0.6 ? mutate(rng, prev, 4) : randomJson(rng, 4)

      const mine = jsonDiff(prev, next)
      const theirs = computeStateDiff(prev, next)

      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        throw new Error(
          `parity mismatch (masterSeed=${masterSeed}, run=${run})\n` +
            `prev=${JSON.stringify(prev)}\n` +
            `next=${JSON.stringify(next)}\n` +
            `jsonDiff=${JSON.stringify(mine)}\n` +
            `computeStateDiff=${JSON.stringify(theirs)}`,
        )
      }
      expect(mine).toEqual(theirs)
    }
  })

  it('agrees on the documented edge cases (type change, escaping, array resize)', () => {
    const cases: Array<[Json, Json]> = [
      [{ a: 1 }, { a: 1, b: 2 }], // add
      [{ a: 1, b: 2 }, { a: 1 }], // remove
      [{ a: 1 }, { a: 2 }], // replace
      [{ a: 1 }, [1, 2]], // object → array type change
      [[1, 2, 3], [1]], // array shrink
      [[1], [1, 2, 3]], // array grow
      [
        { 'x/y': 1, 'z~w': 2 },
        { 'x/y': 9, 'z~w': 2 },
      ], // segment escaping
      [{ a: { b: 1 } }, { a: { b: 1 } }], // no-op
    ]
    for (const [prev, next] of cases) {
      expect(jsonDiff(prev, next)).toEqual(computeStateDiff(prev, next))
    }
  })
})
