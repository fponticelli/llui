// Chunked dirty masks — the runtime core of signal lowering.
//
// Replaces the fixed two-word `mask` + `maskHi` (62-path ceiling, lo/hi
// asymmetry bug class) with N 32-bit chunks. A compiled component carries a
// PathTable (unique dependency paths → bit indices) and, per binding, a sparse
// mask (only the chunks it touches). On each update the runtime computes a dirty
// chunk-set by reference-equality at each tracked path — relying on TEA's
// immutable updates + structural sharing — and gates each binding by overlap.
//
// Invariant: a dep on a path `p` fires whenever the value at `p` changes by
// reference. Combined with the analyzer's coverage soundness (in @llui/compiler:
// any output-affecting change is covered by an emitted path), this yields the
// end-to-end guarantee — a binding re-runs whenever its output could change.
//
// See docs/proposals/signals/README.md "Runtime".

/** Dirty bits, one Uint32 per 32 tracked paths. */
export type Chunks = Uint32Array

export interface PathTable {
  /** bit index -> path */
  paths: string[]
  /** path -> bit index */
  index: Map<string, number>
  /** number of 32-bit chunks needed */
  chunkCount: number
}

/** Build a path→bit table from the union of a component's dependency paths. */
export function buildPathTable(paths: Iterable<string>): PathTable {
  const uniq = [...new Set(paths)]
  const index = new Map<string, number>()
  uniq.forEach((p, i) => index.set(p, i))
  return { paths: uniq, index, chunkCount: Math.max(1, Math.ceil(uniq.length / 32)) }
}

/** Resolve a dotted path against a state value. Undefined-safe; `''` = whole. */
export function resolvePath(state: unknown, path: string): unknown {
  if (path === '') return state
  let cur: unknown = state
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/**
 * Compute the dirty chunk-set: bit `i` is set iff the value at `paths[i]`
 * differs between `oldS` and `newS` by `Object.is`. Short-circuits when the
 * whole state reference is unchanged.
 */
export function computeDirty(table: PathTable, oldS: unknown, newS: unknown): Chunks {
  const chunks = new Uint32Array(table.chunkCount)
  if (Object.is(oldS, newS)) return chunks
  for (let i = 0; i < table.paths.length; i++) {
    const p = table.paths[i]!
    if (!Object.is(resolvePath(oldS, p), resolvePath(newS, p))) {
      chunks[i >>> 5]! |= 1 << (i & 31)
    }
  }
  return chunks
}

/** A binding's dependency mask: only the chunks it actually touches. Most
 * bindings touch one chunk, so this stays ~constant regardless of total paths. */
export type SparseMask = ReadonlyArray<readonly [chunk: number, bits: number]>

/** Build a binding's sparse mask from its dependency paths. */
export function bindingMask(depPaths: Iterable<string>, table: PathTable): SparseMask {
  const byChunk = new Map<number, number>()
  for (const p of depPaths) {
    const bit = table.index.get(p)
    if (bit === undefined) continue
    const chunk = bit >>> 5
    byChunk.set(chunk, (byChunk.get(chunk) ?? 0) | (1 << (bit & 31)))
  }
  return [...byChunk].sort((a, b) => a[0] - b[0])
}

/** Gate: does the binding depend on any currently-dirty bit? */
export function intersects(mask: SparseMask, dirty: Chunks): boolean {
  for (const [chunk, bits] of mask) {
    if (chunk < dirty.length && (dirty[chunk]! & bits) !== 0) return true
  }
  return false
}
