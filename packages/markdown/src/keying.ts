// Content-hash keying of top-level blocks.
//
// The reactive markdown() helper renders top-level blocks through a keyed `each`.
// Keying each block by a hash of its SOURCE SLICE means unchanged blocks keep the
// same key across re-parses, so the reconciler reuses their DOM untouched and only
// the changing tail (and any appended blocks) rebuild — the streaming sweet spot.

import type { Root, RootContent, Nodes } from 'mdast'
import type { ResolvedOptions } from './types.js'

export interface KeyedBlock {
  /** Reconcile identity for the outer keyed list (from `keyOf`, else content-based). */
  key: string | number
  /** Content identity — changes iff the block's source changes. Drives in-place
   * row rebuilds when a custom `keyOf` gives blocks stable identity. */
  hash: string
  node: Nodes
}

/** FNV-1a 32-bit hash → base36. Fast, allocation-light, good enough to key blocks. */
function hash(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** The block's source text (via mdast position offsets), or a structural fallback. */
export function blockSource(node: RootContent, source: string): string {
  const pos = node.position
  if (pos && pos.start.offset != null && pos.end.offset != null) {
    return source.slice(pos.start.offset, pos.end.offset)
  }
  return JSON.stringify(node)
}

/** Derive a stable, unique-per-render key for each top-level block. Identical block
 * source ⇒ identical base key; duplicates get a `#n` suffix to stay unique. */
export function toKeyedBlocks(root: Root, source: string, options: ResolvedOptions): KeyedBlock[] {
  const seen = new Map<string, number>()
  return root.children.map((node, index) => {
    const contentId = `${node.type}:${hash(blockSource(node, source))}`
    if (options.keyOf) return { key: options.keyOf(node, index), hash: contentId, node }
    const dup = seen.get(contentId) ?? 0
    seen.set(contentId, dup + 1)
    return { key: dup === 0 ? contentId : `${contentId}#${dup}`, hash: contentId, node }
  })
}
