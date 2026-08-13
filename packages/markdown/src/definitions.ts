// Incremental collection of the DOCUMENT-GLOBAL labels: link/image reference
// definitions (`[r]: /url`) and GFM footnote definitions (`[^1]: note`).
//
// Two consumers need them on every source change:
//   - the render path, which resolves `linkReference`/`imageReference` nodes
//     through the definition table (`collectDefinitions`), and
//   - the incremental parser, whose reuse guard compares the label ID-SET of the
//     old tree against the incremental one (a label appearing or disappearing can
//     retro-reclassify earlier text, so it forces a full re-parse).
//
// Both used to walk the ENTIRE tree per change, which is O(N) per streamed chunk —
// O(N·k) over a k-chunk stream — even though parsing and per-block hashing are
// already incremental. This module makes that walk incremental too, on two levels:
//
//   1. PER-BLOCK MEMO (`blockLabels`, keyed on NODE IDENTITY). The incremental
//      parser reuses the SAME top-level node objects for the sealed prefix, so a
//      reused block returns its already-collected labels in O(1) without its
//      subtree being touched. A block's subtree never mutates after it is parsed
//      (only `position` offsets are shifted, which labels don't read), so the memo
//      can never go stale.
//   2. PER-ROOT ACCUMULATION (`documentCache`, keyed on ROOT IDENTITY). Blocks that
//      contribute no labels — nearly all of them — are not even recorded, so the
//      per-change merge is O(number of definitions), not O(number of blocks). A
//      root derived by prefix reuse inherits the previous root's entries for the
//      reused range and only folds in the freshly-parsed tail.
//
// CORRECTNESS — a definition in the TAIL must still resolve for a reference in the
// PREFIX. That is exactly why the accumulation is one-directional and the RESULT is
// always the WHOLE-DOCUMENT table: reuse applies to the per-block CONTRIBUTIONS
// (which depend only on the block itself), never to the resolution of a reference.
// A tail definition therefore lands in the same map an earlier block resolves
// against — `keying.ts` re-fingerprints ref-bearing blocks against the current
// table on every change, so a reused prefix block re-renders when a definition it
// consumes arrives or changes, and `incremental.ts` falls back to a full parse when
// the label ID-SET itself changes (a reference that must become a link node).
// Nothing here may narrow a lookup to the prefix's own definitions.

import type { Root, RootContent, Definition, FootnoteDefinition } from 'mdast'
import type { Node } from 'unist'

/** The document-global labels contributed by ONE top-level block, in document
 * (pre-order) order. */
interface BlockLabels {
  readonly definitions: readonly Definition[]
  /** Lowercased GFM footnote-definition identifiers. */
  readonly footnoteIds: readonly string[]
}

/** Shared singleton for the overwhelmingly common label-free block — doubles as
 * the "contributes nothing" marker, so label-free blocks stay out of the entry
 * list entirely. */
const NO_LABELS: BlockLabels = { definitions: [], footnoteIds: [] }

/** One label-bearing top-level block: its index in `root.children` (stable across
 * prefix reuse) and what it contributes. */
interface LabelEntry {
  readonly index: number
  readonly labels: BlockLabels
}

/** The document-global label tables of one tree. */
export interface DocumentLabels {
  /** Link/image reference definitions by lowercased identifier (first wins). */
  readonly definitions: ReadonlyMap<string, Definition>
  /** Namespaced label identifiers — `l:` for reference definitions, `f:` for
   * footnote definitions — so a link def `x` stays distinct from a footnote def
   * `x`. This is the set the incremental parser's reuse guard compares. */
  readonly ids: ReadonlySet<string>
}

interface LabelCache extends DocumentLabels {
  readonly entries: readonly LabelEntry[]
}

/** Number of mdast nodes visited by definition collection. A memoized block costs
 * ZERO visits, so this measures exactly how much of the tree each change walks.
 * Exposed for tests/benchmarks (see {@link definitionNodesVisited}). */
let nodesVisited = 0

/** Number of TOP-LEVEL BLOCKS examined by definition collection — the second,
 * coarser axis. The per-block memo alone would still touch every block of the
 * document on every change (an O(#blocks) memo-lookup sweep, merely cheap per
 * block); only the per-root accumulation removes that sweep. This counter is what
 * pins it: without {@link deriveDocumentLabels} it grows with the document, with
 * it a streamed append stays constant. See {@link definitionBlocksScanned}. */
let blocksScanned = 0

/** Test/benchmark hook: reads (and optionally resets) the number of mdast nodes
 * visited by definition collection. A streamed append must visit only the freshly
 * parsed tail blocks — reused prefix blocks contribute their already-collected
 * definitions without being re-walked. */
export function definitionNodesVisited(reset = false): number {
  const n = nodesVisited
  if (reset) nodesVisited = 0
  return n
}

/** Test/benchmark hook: reads (and optionally resets) the number of TOP-LEVEL
 * BLOCKS examined by definition collection (memoized or not). A streamed append
 * must examine only the freshly parsed tail blocks — the reused prefix is carried
 * over as already-merged entries, so this stays CONSTANT as the document grows
 * rather than sweeping every block per change. */
export function definitionBlocksScanned(reset = false): number {
  const n = blocksScanned
  if (reset) blocksScanned = 0
  return n
}

const blockLabels = new WeakMap<RootContent, BlockLabels>()
const documentCache = new WeakMap<Root, LabelCache>()

/** The labels one top-level block contributes, memoized on node identity. */
function labelsOf(block: RootContent): BlockLabels {
  const memo = blockLabels.get(block)
  if (memo) return memo
  const definitions: Definition[] = []
  const footnoteIds: string[] = []
  const visit = (node: Node): void => {
    nodesVisited++
    if (node.type === 'definition') {
      definitions.push(node as Definition)
    } else if (node.type === 'footnoteDefinition') {
      footnoteIds.push((node as FootnoteDefinition).identifier.toLowerCase())
    }
    const kids = (node as { children?: readonly Node[] }).children
    if (kids) for (const child of kids) visit(child)
  }
  visit(block)
  const labels =
    definitions.length === 0 && footnoteIds.length === 0 ? NO_LABELS : { definitions, footnoteIds }
  blockLabels.set(block, labels)
  return labels
}

/** Fold blocks `[from, end)` of `root` into `entries` (label-free blocks omitted). */
function appendEntries(entries: LabelEntry[], root: Root, from: number): void {
  for (let i = from; i < root.children.length; i++) {
    blocksScanned++
    const labels = labelsOf(root.children[i]!)
    if (labels !== NO_LABELS) entries.push({ index: i, labels })
  }
}

/** Merge ordered entries into the document tables and memoize them on `root`. */
function buildCache(root: Root, entries: readonly LabelEntry[]): LabelCache {
  const definitions = new Map<string, Definition>()
  const ids = new Set<string>()
  for (const entry of entries) {
    for (const def of entry.labels.definitions) {
      const id = def.identifier.toLowerCase()
      ids.add('l:' + id)
      // First definition wins, exactly as a whole-tree document-order walk does.
      if (!definitions.has(id)) definitions.set(id, def)
    }
    for (const id of entry.labels.footnoteIds) ids.add('f:' + id)
  }
  const cache: LabelCache = { definitions, ids, entries }
  documentCache.set(root, cache)
  return cache
}

/** The label tables of `root`, computed once per tree (memoized on root identity).
 * A tree built by prefix reuse normally arrives here already populated by
 * {@link deriveDocumentLabels}; otherwise every block is folded in (each via the
 * per-block memo, so blocks shared with an earlier tree are still free). */
function cacheFor(root: Root): LabelCache {
  const cached = documentCache.get(root)
  if (cached) return cached
  const entries: LabelEntry[] = []
  appendEntries(entries, root, 0)
  return buildCache(root, entries)
}

/** The document-global labels of `root` (see {@link DocumentLabels}). */
export function collectDocumentLabels(root: Root): DocumentLabels {
  return cacheFor(root)
}

/** Walk the tree and collect every link/image reference definition, keyed by
 * lowercased identifier (so `linkReference`/`imageReference` nodes can resolve).
 * The result is the WHOLE-document table — a definition anywhere, including one
 * that arrives late in a streamed tail, resolves for a reference anywhere.
 *
 * Collection is incremental: blocks reused from the previous parse contribute
 * their already-collected definitions instead of being re-walked, so a streamed
 * append costs O(tail) rather than O(document).
 *
 * BREAKING (behaviour, not just the type): this used to build and hand back a
 * FRESH, safely-mutable `Map` on every call. It now returns the LIVE memoized
 * table for that tree. The `ReadonlyMap` type says so, but a cast defeats it —
 * `(collectDefinitions(root) as Map<string, Definition>).delete('r')` permanently
 * poisons the cache for `root`, and every later render of that tree sees the
 * damage. Copy it (`new Map(collectDefinitions(root))`) if you need to mutate.
 * For the same reason the tree itself is treated as immutable once parsed: do not
 * mutate a tree's nodes and re-collect, the memo will not notice. */
export function collectDefinitions(root: Root): ReadonlyMap<string, Definition> {
  return cacheFor(root).definitions
}

/** The namespaced label ids contributed by the first `count` top-level blocks of
 * `root` — what the incremental parser injects ahead of a tail parse so a tail
 * reference pointing at a PREFIX definition still forms a reference node. */
export function prefixLabelIds(root: Root, count: number): ReadonlySet<string> {
  const out = new Set<string>()
  for (const entry of cacheFor(root).entries) {
    if (entry.index >= count) break
    for (const def of entry.labels.definitions) out.add('l:' + def.identifier.toLowerCase())
    for (const id of entry.labels.footnoteIds) out.add('f:' + id)
  }
  return out
}

/** Derive `root`'s label tables INCREMENTALLY from `previousRoot`'s.
 *
 * The caller must guarantee that `root.children[i] === previousRoot.children[i]`
 * for every `i < reusedPrefix` — which is precisely what `incrementalParse`
 * constructs (it slices the reused blocks off the previous tree, preserving their
 * indices). Under that guarantee the first `reusedPrefix` blocks' contributions
 * are carried over verbatim and only the freshly-parsed tail is walked. */
export function deriveDocumentLabels(
  root: Root,
  previousRoot: Root,
  reusedPrefix: number,
): DocumentLabels {
  const cached = documentCache.get(root)
  if (cached) return cached
  if (reusedPrefix <= 0) return cacheFor(root)
  const entries: LabelEntry[] = []
  for (const entry of cacheFor(previousRoot).entries) {
    if (entry.index >= reusedPrefix) break
    entries.push(entry)
  }
  appendEntries(entries, root, reusedPrefix)
  return buildCache(root, entries)
}
