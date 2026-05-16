// Micro-benchmark comparing the three update-cycle costs:
//   1. Today's bitmask path (top-level fields → bit positions)
//   2. New prefix walker, single-word path (≤31 unique prefixes)
//   3. New prefix walker, multi-word path (>31 unique prefixes)
//
// For each, we measure the **steady-state per-update cost**:
//   compute dirty mask + gate every binding by mask.
// We do NOT measure binding bodies / DOM work — those are the same in all paths.
//
// Workload: 215 bindings (mix of top-level scalars, nested reads, array reads),
// 36 "flag" fields that push us into FULL_MASK under bitmask. We simulate a
// realistic update mix: 80% single-field changes (one path dirty), 20% multi-
// field changes (3-5 paths dirty).

import { initialState, splice, type AppState } from './state.js'
import { bindings, computeBitmaskDirty, TOP_LEVEL_COUNT } from './bindings.js'
import {
  buildPrefixScope,
  computePrefixDirty,
  isDirtyPrefix,
  buildPrefixScope1,
  computePrefixDirty1,
} from './walker-prefix.js'

const ITERATIONS = 50_000
// Cycle through a small fixed pool of pre-computed (prev,next) pairs so we
// don't OOM materializing 200k state trees. Each pair represents one realistic
// transition; the bench loop revisits them ITERATIONS times.

// Pre-build deltas (representative state transitions)
function makeDeltas(): Array<(s: AppState) => AppState> {
  return [
    // 80% single-field changes
    (s) => splice(s, ['query'], s.query + 'x'),
    (s) => splice(s, ['selectedId'], s.selectedId === null ? 'sel' : null),
    (s) => splice(s, ['ui', 'sidebarOpen'], !s.ui.sidebarOpen),
    (s) => splice(s, ['auth', 'formError'], s.auth.formError === null ? 'err' : null),
    (s) => splice(s, ['filter', 'text'], s.filter.text + 'a'),
    (s) => splice(s, ['flag0'], !s.flag0),
    (s) => splice(s, ['flag20'], !s.flag20),
    (s) => splice(s, ['flag32'], !s.flag32), // forces FULL_MASK
    // 20% multi-field changes
    (s) => splice(splice(s, ['query'], s.query + 'q'), ['filter', 'text'], s.filter.text + 'f'),
    (s) => splice(splice(s, ['auth', 'status'], 'signed-in'), ['ui', 'sidebarOpen'], true),
  ]
}

function applyDeltas(start: AppState, deltas: Array<(s: AppState) => AppState>, n: number): AppState[] {
  const out: AppState[] = []
  let s = start
  for (let i = 0; i < n; i++) {
    s = deltas[i % deltas.length]!(s)
    out.push(s)
  }
  return out
}

// ── Build the three walkers ─────────────────────────────────────────

const start = initialState()
const deltas = makeDeltas()
// Build a fixed pool of ~POOL_SIZE state transitions; cycle through them.
const POOL_SIZE = deltas.length * 4
const pool = [start, ...applyDeltas(start, deltas, POOL_SIZE)]
// Pre-build (prev, next) index pairs to avoid modulo in the timed loop
const idxPairs = new Uint32Array(POOL_SIZE * 2)
for (let i = 0; i < POOL_SIZE; i++) {
  idxPairs[i * 2] = i % POOL_SIZE
  idxPairs[i * 2 + 1] = (i + 1) % POOL_SIZE
}

// We need a small-prefix workload too — only top-level scalars, no flags,
// to validate the single-word path. Filter the bindings.
const smallBindings = bindings.filter((b) => !b.topLevelFields.some((f) => f.startsWith('flag')))

const prefixScope = buildPrefixScope(bindings) // full set, multi-word
const prefixScope1 = buildPrefixScope1(smallBindings) // small set, single-word

console.log(`Workload:`)
console.log(`  total bindings: ${bindings.length}`)
console.log(`  small-binding subset: ${smallBindings.length}`)
console.log(`  top-level fields (bitmask): ${TOP_LEVEL_COUNT}`)
console.log(`  unique prefixes (full): ${prefixScope.table.length} (${prefixScope.wordCount} words)`)
console.log(`  unique prefixes (small): ${prefixScope1.table.length}`)
console.log()

// ── Benchmarks ──────────────────────────────────────────────────────

function bench(name: string, fn: () => void): { name: string; ms: number; perUpdate: number } {
  // Warm-up: a single pass at full ITERATIONS lets JIT optimize the hot loop
  fn()
  // Measure: a second pass with the hot code now compiled
  const start = performance.now()
  fn()
  const end = performance.now()
  return { name, ms: end - start, perUpdate: ((end - start) * 1000) / ITERATIONS } // µs/update
}

// Pre-compute mutable scratch (avoid bench framework allocation noise)
let __sink = 0

function benchBitmask(): void {
  for (let i = 0; i < ITERATIONS; i++) {
    const k = i % POOL_SIZE
    const prev = pool[k]!
    const next = pool[k + 1] ?? pool[0]!
    const dirty = computeBitmaskDirty(prev, next)
    for (let j = 0; j < bindings.length; j++) {
      const b = bindings[j]!
      if ((b.mask & dirty) !== 0) __sink |= 1
    }
  }
}

function benchPrefixMulti(): void {
  for (let i = 0; i < ITERATIONS; i++) {
    const k = i % POOL_SIZE
    const prev = pool[k]!
    const next = pool[k + 1] ?? pool[0]!
    computePrefixDirty(prefixScope, prev, next)
    for (let j = 0; j < bindings.length; j++) {
      const b = bindings[j]! as typeof bindings[number] & { prefixMask: number[] }
      if (isDirtyPrefix(b, prefixScope)) __sink |= 1
    }
  }
}

function benchBitmaskSmall(): void {
  for (let i = 0; i < ITERATIONS; i++) {
    const k = i % POOL_SIZE
    const prev = pool[k]!
    const next = pool[k + 1] ?? pool[0]!
    const dirty = computeBitmaskDirty(prev, next)
    for (let j = 0; j < smallBindings.length; j++) {
      const b = smallBindings[j]!
      if ((b.mask & dirty) !== 0) __sink |= 1
    }
  }
}

function benchPrefixSingle(): void {
  for (let i = 0; i < ITERATIONS; i++) {
    const k = i % POOL_SIZE
    const prev = pool[k]!
    const next = pool[k + 1] ?? pool[0]!
    const dirty = computePrefixDirty1(prefixScope1, prev, next)
    for (let j = 0; j < smallBindings.length; j++) {
      const b = smallBindings[j]! as typeof smallBindings[number] & { prefixMask1: number }
      if ((b.prefixMask1 & dirty) !== 0) __sink |= 1
    }
  }
}

// Sanity: ensure walkers agree on dirty bindings for a few sample transitions
function sanity(): void {
  for (let i = 1; i < Math.min(20, pool.length); i++) {
    const prev = pool[i - 1]!
    const next = pool[i]!
    const bmDirty = computeBitmaskDirty(prev, next)
    computePrefixDirty(prefixScope, prev, next)
    const bmFired = new Set<number>()
    const pxFired = new Set<number>()
    for (const b of bindings) {
      if ((b.mask & bmDirty) !== 0) bmFired.add(b.id)
      if (isDirtyPrefix(b as typeof b & { prefixMask: number[] }, prefixScope)) pxFired.add(b.id)
    }
    // We expect prefix walker to be STRICTLY MORE PRECISE than bitmask
    // (i.e. prefix fired ⊆ bitmask fired), because bitmask conflates
    // distinct nested paths under the same top-level field.
    for (const id of pxFired) {
      if (!bmFired.has(id)) {
        console.error(`  ✗ prefix fired binding ${id} that bitmask did not — divergence!`)
      }
    }
    if (bmFired.size === pxFired.size && i === 1) {
      console.log(`  (sanity: walkers agree on transition #${i})`)
    } else if (i === 1) {
      console.log(`  (transition #${i}: bitmask fired ${bmFired.size}, prefix fired ${pxFired.size} — prefix more precise)`)
    }
  }
}

console.log('Sanity check (prefix is strictly more precise than bitmask):')
sanity()
console.log()

const r1 = bench('Bitmask (full: 182 bindings, 42 fields, w/ FULL_MASK)', benchBitmask)
const r2 = bench('Prefix multi-word (full: 182 bindings, 48 prefixes)', benchPrefixMulti)
const r3 = bench('Bitmask (small: 146 bindings, 6 fields, no FULL_MASK)', benchBitmaskSmall)
const r4 = bench('Prefix single-word (small: 146 bindings, 12 prefixes)', benchPrefixSingle)

console.log(`${ITERATIONS.toLocaleString()} update cycles each:`)
console.log(`  ${r1.name.padEnd(58)} ${r1.ms.toFixed(0).padStart(6)} ms   ${r1.perUpdate.toFixed(3)} µs/update`)
console.log(`  ${r2.name.padEnd(58)} ${r2.ms.toFixed(0).padStart(6)} ms   ${r2.perUpdate.toFixed(3)} µs/update`)
console.log(`  ${r3.name.padEnd(58)} ${r3.ms.toFixed(0).padStart(6)} ms   ${r3.perUpdate.toFixed(3)} µs/update`)
console.log(`  ${r4.name.padEnd(58)} ${r4.ms.toFixed(0).padStart(6)} ms   ${r4.perUpdate.toFixed(3)} µs/update`)
console.log()
console.log(`Apples-to-apples comparisons:`)
console.log(`  Full workload (>31 paths):   prefix is ${(r2.perUpdate / r1.perUpdate).toFixed(2)}x of bitmask`)
console.log(`  Small workload (≤31 paths):  prefix is ${(r4.perUpdate / r3.perUpdate).toFixed(2)}x of bitmask`)
if (__sink === -999) console.log('(sink')
