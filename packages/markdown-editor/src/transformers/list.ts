// The list transformers.
//
// ## `- [X]` lost its tick (issue #100)
//
// Upstream matches the task marker case-INSENSITIVELY (`…(\[(\s|x)?\])\s/i`)
// and then derives the state case-SENSITIVELY (`match[3] === 'x'`). So
// `- [X] done` IS recognised as a task item — the marker is consumed — and then
// reads as unchecked. GFM accepts both cases and GitHub renders `[X]` as ticked,
// so the value was lost on IMPORT: a document opened and re-saved came back with
// the user's box cleared, and nothing reported it. {@link isCheckedMarker} is
// the one place that question is asked, here and in `list-shortcuts.ts`.
//
// ## A marker change starts a new list (issue #129)
//
// CommonMark 0.31 §5.3. Upstream's `listReplace` decides whether to join a
// neighbouring list on `listType` alone — `-`, `*` and `+` are all `bullet` —
// so `- a` / `* b` collapsed into one list and the second marker was lost on
// export. The marker has to be part of that decision, which is why this module
// owns `listReplace` rather than wrapping it: the decision IS the function, and
// a wrapper would have to re-derive upstream's branch order just to find the
// node upstream created. Owning the import half means owning the export half
// too — upstream's `$listExport` reads a marker recorded by upstream's
// `listReplace`, under a `createState` key `@lexical/markdown` does not export.
//
// The node half is `nodes/list.ts`, and it is the load-bearing one: two
// adjacent same-type lists cannot survive in a stock Lexical tree at all,
// whoever built them. Read that module's header before changing anything here.
//
// This is a fork of ~110 lines of `@lexical/markdown` internals, joining the
// fenced-code and image forks. `listReplace` belongs to the SAME class as those
// two — regex-driven line import — and an mdast importer WOULD retire it. Do
// not read this module as licence to skip lists when that importer is built.
// What survives it is the other half: `nodes/list.ts` (a node-MODEL
// disagreement no importer can reach — parse `- a` / `* b` with any CommonMark
// parser you like and Lexical still merges the two lists it produces) and
// `$listExport`, which has no importer to be retired by and must keep emitting
// the authored marker. mdast also carries no bullet character, so an importer
// would need `position` and the source text to feed `setMarker`.
//
// ## What upstream's flat model can and cannot express
//
// `$importBlocks` gives an indented item `setIndent(n)` inside the SAME list
// rather than building a real subtree, so "the marker of a list" can only mean
// its TOP-LEVEL marker. An indented item therefore neither records a marker nor
// tests one — otherwise a nested marker change would tear the outer list in two.
//
// Two consequences of that flatness, both deliberate and both observable:
//
//  - "Indented" means `getIndent`, which counts TABS and floors spaces at four.
//    So `- a\n    * b` is one list with a nested item (the `*` is ignored), but
//    `- a\n  * b` — a 1-to-3-space indent — is not indented at all as far as
//    this importer is concerned, and the marker change splits it into TWO
//    lists where stock produced one. CommonMark would call the second a
//    sublist; matching that needs the real subtree the flat model does not
//    build, so it is left as a known divergence rather than special-cased.
//  - A nested marker is LOST on export. `$listExport` reads the marker of the
//    list it is rendering, and an indented item never recorded one, so
//    `- a\n    * b` comes back as `- a\n    - b`. The round-trip guarantee
//    "`* a` round-trips as `* a`" is therefore TOP-LEVEL ONLY.

import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
  type ListType,
} from '@lexical/list'
import { $isHeadingNode } from '@lexical/rich-text'
import type { ElementTransformer } from '@lexical/markdown'
import type { BaseSelection, ElementNode, LexicalNode } from 'lexical'
import { $isMarkdownListNode, asListMarker, type ListMarker } from '../nodes/list.js'

/**
 * Whether a task marker's interior means "ticked". GFM ticks `[x]` and `[X]`
 * alike; reading it case-sensitively is exactly the #100 defect, so every place
 * that asks the question asks it through this one predicate.
 */
export function isCheckedMarker(inner: string | undefined): boolean {
  return inner !== undefined && inner.toLowerCase() === 'x'
}

/** Spaces per indent level, matching upstream's importer and exporter. */
const LIST_INDENT_SIZE = 4

/** Indent level of a line's leading whitespace — a tab is one level, four
 * spaces are one level. (Upstream's `getIndent`, which is not exported.) */
function getIndent(whitespaces: string): number {
  const tabs = whitespaces.match(/\t/g)
  const spaces = whitespaces.match(/ /g)
  return (tabs === null ? 0 : tabs.length) + (spaces === null ? 0 : Math.floor(spaces.length / 4))
}

/** How one list flavour reads its own matched line. Group numbering is this
 * module's own, since it owns both the patterns and the reader. */
interface ListSpec {
  readonly listType: ListType
  /** The authored marker, or `null` when the syntax carries none (a bare
   * `[ ] task` with no bullet). */
  readonly marker: (match: string[]) => ListMarker | null
  /** The ordered start value, or `undefined` for an unordered list. */
  readonly start?: (match: string[]) => number
  /** The initial checked state, or `undefined` for a non-task item. */
  readonly checked?: (match: string[]) => boolean
}

/**
 * Build a list item from a matched line, joining a neighbouring list only when
 * CommonMark says the two are the same list.
 *
 * A port of upstream's `listReplace` with two changes: the join test consults
 * the marker (#129), and the tick is read case-insensitively (#100).
 */
function listReplace(spec: ListSpec): ElementTransformer['replace'] {
  return (
    parentNode: ElementNode,
    children: LexicalNode[],
    match: string[],
    isImport: boolean,
  ): boolean | void => {
    // `# ` already claimed this line as a heading.
    if ($isHeadingNode(parentNode)) return false

    const indent = getIndent(match[1] ?? '')
    // Only a top-level item speaks for its list's marker — see the module
    // header on upstream's flat, indent-based nesting.
    const marker = indent === 0 ? spec.marker(match) : null
    const start = spec.start?.(match)
    const listItem = $createListItemNode(spec.checked?.(match))

    const joinable = (node: LexicalNode | null): boolean => {
      if (!$isMarkdownListNode(node) || node.getListType() !== spec.listType) return false
      const existing = node.getMarker()
      return marker === null || existing === null || existing === marker
    }
    /** A list the author spelled a marker for keeps it; one that had none
     * adopts the marker of the item joining it. */
    const recordMarker = (node: ReturnType<typeof $createListNode>): void => {
      if (marker !== null && $isMarkdownListNode(node) && node.getMarker() === null) {
        node.setMarker(marker)
      }
    }

    const nextNode = parentNode.getNextSibling()
    const previousNode = parentNode.getPreviousSibling()

    if (joinable(nextNode) && $isListNode(nextNode)) {
      recordMarker(nextNode)
      const firstChild = nextNode.getFirstChild()
      if (firstChild !== null) firstChild.insertBefore(listItem)
      else nextNode.append(listItem)
      // The new item lands at index 0, so the typed number becomes the list's
      // starting value.
      if (spec.listType === 'number' && start !== undefined) nextNode.setStart(start)
      parentNode.remove()
    } else if (joinable(previousNode) && $isListNode(previousNode)) {
      recordMarker(previousNode)
      // Appended at the end, inheriting the existing sequence — the typed
      // number is intentionally ignored here.
      previousNode.append(listItem)
      parentNode.remove()
    } else {
      const list = $createListNode(spec.listType, start)
      recordMarker(list)
      list.append(listItem)
      parentNode.replace(list)
    }

    listItem.append(...children)
    if (!isImport) listItem.select(0, 0)
    if (indent) listItem.setIndent(indent)
  }
}

/** The marker to export a list under, falling back to the CommonMark-canonical
 * spelling for a list nobody authored one for. */
function exportMarker(
  list: ListNode,
  fallback: ListMarker,
  allowed: readonly ListMarker[],
): string {
  const marker = $isMarkdownListNode(list) ? list.getMarker() : null
  return marker !== null && allowed.includes(marker) ? marker : fallback
}

const BULLETS: readonly ListMarker[] = ['-', '*', '+']
const DELIMITERS: readonly ListMarker[] = ['.', ')']

/**
 * Render a list back to markdown. A port of upstream's `$listExport`, emitting
 * the authored marker / ordered delimiter instead of a hard-coded `-` and `.`.
 */
function $listExport(
  listNode: ListNode,
  exportChildren: (node: ElementNode) => string,
  depth: number,
  selection?: BaseSelection | null,
): string {
  const output: string[] = []
  const listType = listNode.getListType()
  const bullet = exportMarker(listNode, '-', BULLETS)
  const delimiter = exportMarker(listNode, '.', DELIMITERS)
  let index = 0

  for (const listItemNode of listNode.getChildren()) {
    if (!$isListItemNode(listItemNode)) continue

    if (listItemNode.getChildrenSize() === 1) {
      const firstChild = listItemNode.getFirstChild()
      if ($isListNode(firstChild)) {
        const nested = $listExport(firstChild, exportChildren, depth + 1, selection)
        if (nested) output.push(nested)
        continue
      }
    }

    // Skip unselected items when a selection is provided (copy-as-markdown).
    if (selection && !listItemNode.getChildren().some((child) => child.isSelected(selection))) {
      continue
    }

    const prefix =
      listType === 'number'
        ? `${listNode.getStart() + index}${delimiter} `
        : listType === 'check'
          ? `${bullet} [${listItemNode.getChecked() ? 'x' : ' '}] `
          : `${bullet} `
    let childrenText = exportChildren(listItemNode)
    // A bullet item whose text opens with `1. ` would read back as an ordered
    // list; escape the delimiter so it stays text. `)` counts as well, now that
    // it is a delimiter this package understands.
    if (listType !== 'number')
      childrenText = childrenText.replace(/^(\s{0,3}\d+)([.)]\s)/, '$1\\$2')
    output.push(' '.repeat(depth * LIST_INDENT_SIZE) + prefix + childrenText)
    index++
  }

  return output.join('\n')
}

const exportList: ElementTransformer['export'] = (node, exportChildren, selection) =>
  $isListNode(node) ? $listExport(node, exportChildren, 0, selection) : null

const LIST_DEPENDENCIES = [ListNode, ListItemNode]

/** `- a` / `* a` / `+ a` ⇄ a bullet list. */
export const UNORDERED_LIST_TRANSFORMER: ElementTransformer = {
  dependencies: LIST_DEPENDENCIES,
  export: exportList,
  regExp: /^(\s*)([-*+])\s/,
  replace: listReplace({
    listType: 'bullet',
    marker: (match) => asListMarker(match[2]),
  }),
  triggerOnEnter: true,
  type: 'element',
}

/**
 * `1. a` / `1) a` ⇄ an ordered list.
 *
 * Upstream only reads `.`; CommonMark gives `)` equal standing and §5.3 treats a
 * delimiter change exactly like a bullet change, which is the third case in
 * #129's acceptance criteria. No blank line is needed between them:
 * `$convertFromMarkdownString`'s `shouldMergeAdjacentLines` defaults to `false`
 * and no call site in this package overrides it, so `1. a\n1) b` imports as two
 * ordered lists. (Stock swallows `1) b` as text, so this is strictly better.)
 */
export const ORDERED_LIST_TRANSFORMER: ElementTransformer = {
  dependencies: LIST_DEPENDENCIES,
  export: exportList,
  regExp: /^(\s*)(\d{1,9})([.)])\s/,
  replace: listReplace({
    listType: 'number',
    marker: (match) => asListMarker(match[3]),
    start: (match) => Number(match[2]),
  }),
  triggerOnEnter: true,
  type: 'element',
}

/** `- [ ]` / `- [x]` / `- [X]` (and a bare `[ ]`) ⇄ a check list. */
export const CHECK_LIST_TRANSFORMER: ElementTransformer = {
  dependencies: LIST_DEPENDENCIES,
  export: exportList,
  regExp: /^(\s*)(?:([-*+])\s)?\s?(\[([\sxX]?)\])\s/,
  replace: listReplace({
    listType: 'check',
    marker: (match) => asListMarker(match[2]),
    checked: (match) => isCheckedMarker(match[4]),
  }),
  triggerOnEnter: true,
  type: 'element',
}
