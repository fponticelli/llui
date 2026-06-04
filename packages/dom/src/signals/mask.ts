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

/** One leaf under a root: its bit index plus the pre-split segments BELOW the
 * root (empty for a path that IS its own root, e.g. `'item'` or `''`). */
type RootEntry = readonly [bit: number, suffixSegs: readonly string[]]

/** Paths grouped by their top-level segment. If the value at a root is
 * reference-unchanged between two states, EVERY leaf under it is clean — so the
 * dirty computation can dismiss the whole subtree with a single `Object.is`,
 * and never touches its descendants. Sound under TEA's immutable updates +
 * structural sharing (same ref ⇒ identical descendants). */
interface RootGroup {
  /** segments to resolve the root value (`[]` = whole state). */
  readonly rootSegs: readonly string[]
  readonly entries: readonly RootEntry[]
}

export interface PathTable {
  /** bit index -> path */
  paths: string[]
  /** path -> bit index */
  index: Map<string, number>
  /** number of 32-bit chunks needed */
  chunkCount: number
  /** paths grouped by top-level root, for subtree short-circuiting */
  roots: readonly RootGroup[]
}

/** Build a path→bit table from the union of a component's dependency paths. */
export function buildPathTable(paths: Iterable<string>): PathTable {
  const uniq = [...new Set(paths)]
  const index = new Map<string, number>()
  uniq.forEach((p, i) => index.set(p, i))
  // Group leaves by their first segment so an unchanged subtree short-circuits.
  const byRoot = new Map<string, { rootSegs: string[]; entries: RootEntry[] }>()
  uniq.forEach((p, i) => {
    const segs = p === '' ? [] : p.split('.')
    const root = segs.length === 0 ? '' : segs[0]!
    let group = byRoot.get(root)
    if (!group) {
      group = { rootSegs: segs.length === 0 ? [] : [root], entries: [] }
      byRoot.set(root, group)
    }
    group.entries.push([i, segs.slice(1)])
  })
  return {
    paths: uniq,
    index,
    chunkCount: Math.max(1, Math.ceil(uniq.length / 32)),
    roots: [...byRoot.values()],
  }
}

/** Walk pre-split segments against a value. Undefined-safe; `[]` = whole. */
function resolveSegs(value: unknown, segs: readonly string[]): unknown {
  let cur: unknown = value
  for (const seg of segs) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** Resolve a dotted path against a state value. Undefined-safe; `''` = whole. */
export function resolvePath(state: unknown, path: string): unknown {
  return resolveSegs(state, path === '' ? [] : path.split('.'))
}

/** Resolve a value from PRE-SPLIT path segments — no per-call `String.split`.
 * Used by path-rooted signal handles, which split their base path once at
 * creation and then read through this on every binding evaluation. */
export function resolveSegments(value: unknown, segs: readonly string[]): unknown {
  return resolveSegs(value, segs)
}

/**
 * Compute the dirty chunk-set: bit `i` is set iff the value at `paths[i]`
 * differs between `oldS` and `newS` by `Object.is`. Short-circuits when the
 * whole state reference is unchanged, AND — per root group — when a top-level
 * subtree's reference is unchanged (so an unchanged subtree's leaves are never
 * resolved; this is the per-row fast path that keeps `each` updates O(changed
 * rows) rather than O(all rows × paths)).
 */
export function computeDirty(table: PathTable, oldS: unknown, newS: unknown): Chunks {
  const chunks = new Uint32Array(table.chunkCount)
  computeDirtyInto(table, oldS, newS, chunks)
  return chunks
}

/**
 * Allocation-free variant: zero `out` (caller-owned, length `table.chunkCount`)
 * and fill it with the dirty chunk-set, returning whether ANY bit was set. A
 * scope owns one buffer and reuses it across updates, so a hot `each` reconcile
 * doing N row updates per tick allocates zero dirty masks instead of N.
 */
export function computeDirtyInto(
  table: PathTable,
  oldS: unknown,
  newS: unknown,
  out: Chunks,
): boolean {
  out.fill(0)
  if (Object.is(oldS, newS)) return false
  let any = false
  for (const group of table.roots) {
    const oldRoot = resolveSegs(oldS, group.rootSegs)
    const newRoot = resolveSegs(newS, group.rootSegs)
    if (Object.is(oldRoot, newRoot)) continue // subtree unchanged: all leaves clean
    for (const [bit, suffix] of group.entries) {
      if (!Object.is(resolveSegs(oldRoot, suffix), resolveSegs(newRoot, suffix))) {
        out[bit >>> 5]! |= 1 << (bit & 31)
        any = true
      }
    }
  }
  return any
}

/** Whether any dirty bit is set — lets a scope skip its binding loop entirely. */
export function anyDirty(chunks: Chunks): boolean {
  for (let i = 0; i < chunks.length; i++) if (chunks[i] !== 0) return true
  return false
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
