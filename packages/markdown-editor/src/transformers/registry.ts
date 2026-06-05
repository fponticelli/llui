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
