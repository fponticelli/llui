// The transformer registry: flatten plugin transformer contributions into a
// single, correctly-ordered Lexical TRANSFORMERS array. Ordering is the single
// place markdown round-trip fidelity is governed.

import type { Transformer } from '@lexical/markdown'
import type { MarkdownPlugin } from '../plugins/types.js'

// Lexical resolves transformers in array order. Element/multiline constructs
// must be tried before inline text matching, and longer text-format patterns
// (e.g. `***`) before shorter (`**`, `*`) so they aren't shadowed.
const TYPE_RANK: Record<string, number> = {
  'multiline-element': 0,
  element: 1,
  'text-format': 2,
  'text-match': 3,
}

/**
 * Explicit ordering between transformers of the SAME rank.
 *
 * Within a rank Lexical falls back to array position, which for text-match
 * transformers means `findOutermostTextMatchTransformer` breaks a tie — two
 * transformers matching at the SAME start index — by plugin array order. That
 * makes round-trip fidelity depend on the order a consumer happens to list
 * plugins in, which is exactly the failure mode the registry exists to prevent.
 *
 * A transformer that must be consulted ahead of a same-rank peer declares a
 * LOWER precedence here (default 0). This is a side table rather than a field on
 * the transformer because the colliding peers include upstream's `LINK`, which
 * this package does not own and cannot annotate.
 */
const precedence = new WeakMap<Transformer, number>()

/** Declare that `transformer` must be consulted before same-rank peers with a
 * higher value. Call at module scope, beside the transformer's definition. */
export function setTransformerPrecedence(transformer: Transformer, value: number): void {
  precedence.set(transformer, value)
}

/** Stable-sort transformers into the order Lexical expects. */
export function orderTransformers(transformers: readonly Transformer[]): Transformer[] {
  return [...transformers].sort((a, b) => {
    const ra = TYPE_RANK[a.type] ?? 9
    const rb = TYPE_RANK[b.type] ?? 9
    if (ra !== rb) return ra - rb
    if (a.type === 'text-format' && b.type === 'text-format') {
      // Longer trigger (`***`) before shorter (`**`, `*`).
      return b.tag.length - a.tag.length
    }
    const pa = precedence.get(a) ?? 0
    const pb = precedence.get(b) ?? 0
    if (pa !== pb) return pa - pb
    // Equal precedence: `Array.prototype.sort` is specified stable, so the
    // plugin array order is preserved — the documented default.
    return 0
  })
}

/** Collect every plugin's transformers (de-duplicated by reference) and order
 * them. The result is passed to `$convertTo/FromMarkdownString` and
 * `registerMarkdownShortcuts`. */
export function buildTransformers(plugins: readonly MarkdownPlugin[]): Transformer[] {
  const seen = new Set<Transformer>()
  const collected: Transformer[] = []
  for (const plugin of plugins) {
    for (const transformer of plugin.transformers ?? []) {
      if (!seen.has(transformer)) {
        seen.add(transformer)
        collected.push(transformer)
      }
    }
  }
  return orderTransformers(collected)
}
