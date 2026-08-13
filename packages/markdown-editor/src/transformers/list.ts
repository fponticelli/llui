// The list transformers — thin corrections layered over `@lexical/markdown`'s.
//
// ## `- [X]` lost its tick (issue #100)
//
// Upstream matches the task marker case-INSENSITIVELY:
//
//   const CHECK_LIST_REGEX = /^(\s*)(?:[-*+]\s)?\s?(\[(\s|x)?\])\s/i
//
// and then derives the state case-SENSITIVELY:
//
//   listType === 'check' ? match[3] === 'x' : undefined
//
// So `- [X] done` IS recognised as a task item — the marker is consumed — and
// then reads as unchecked. GFM accepts both cases and GitHub renders `[X]` as
// ticked, so the value is lost on IMPORT: a document opened and re-saved comes
// back with the user's box cleared, and nothing reports it. The `/i` flag is
// what makes the disagreement reachable; without it `- [X] done` would fall
// through to the plain bullet transformer and at least keep its text.
//
// This is a WRAPPER, not a fork. The two halves disagree about one character's
// case, so the fix is to hand upstream a tick it will read the way its own
// regex matched it — everything else (the sibling merge, the indent, the bullet
// marker it records for export) stays upstream's, where it is correct. Forking
// `listReplace` to change one comparison would put ~60 lines of upstream
// internals under this package's maintenance for no gain. If Lexical fixes the
// comparison, this wrapper becomes a no-op and can be deleted outright.

import { CHECK_LIST, type ElementTransformer } from '@lexical/markdown'

/**
 * Whether a task marker's interior means "ticked". GFM ticks `[x]` and `[X]`
 * alike; reading it case-sensitively is exactly the #100 defect, so every place
 * that asks the question — the importer here and the typing shortcut in
 * `list-shortcuts.ts` — asks it through this one predicate.
 */
export function isCheckedMarker(inner: string | undefined): boolean {
  return inner !== undefined && inner.toLowerCase() === 'x'
}

/**
 * `- [ ]` / `- [x]` / `- [X]` ⇄ a check-list item.
 *
 * Identical to upstream's `CHECK_LIST` except that the captured tick is
 * lowercased before upstream reads it. Only group 3 is touched: upstream's
 * `listReplace` also reads group 0 (the consumed length), group 1 (the indent)
 * and group 2 (the ordered start), and those must arrive verbatim.
 */
export const CHECK_LIST_TRANSFORMER: ElementTransformer = {
  ...CHECK_LIST,
  replace: (parentNode, children, match, isImport) => {
    const normalized = [...match]
    const tick = match[3]
    if (typeof tick === 'string') normalized[3] = tick.toLowerCase()
    return CHECK_LIST.replace(parentNode, children, normalized, isImport)
  },
}
