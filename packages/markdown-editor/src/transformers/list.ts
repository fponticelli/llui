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
// ## Content-indentation nesting (issue #226)
//
// Lexical hands an element transformer one source line at a time. CommonMark
// list depth, however, depends on the still-open parent items: a child begins at
// its parent's content indentation, which varies with the marker width and the
// following one-to-four padding columns. Tabs use four-column stops. The
// editor-local open-item stack below carries exactly that context across
// consecutive list lines, translates the resulting structural depth into the
// `setIndent(n)` shape Lexical expects, and anchors itself to the preceding list
// so it cannot leak across editors, imports, or intervening blocks.
//
// "The marker of a list" remains top-level-only during `listReplace`: testing a
// nested item's marker before `setIndent` materializes its subtree would split
// the outer list. Consequently the exact character of a nested same-type marker
// still normalizes on export (`- a\n    * b` → `- a\n    - b`). Structure and
// list type survive; exact nested marker spelling is a separate concern.

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
import {
  $getEditor,
  $isParagraphNode,
  $isTextNode,
  type BaseSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { $isMarkdownListNode, asListMarker, type ListMarker } from '../nodes/list.js'

/**
 * Whether a task marker's interior means "ticked". GFM ticks `[x]` and `[X]`
 * alike; reading it case-sensitively is exactly the #100 defect, so every place
 * that asks the question asks it through this one predicate.
 */
export function isCheckedMarker(inner: string | undefined): boolean {
  return inner !== undefined && inner.toLowerCase() === 'x'
}

/** Spaces used to encode a resolved structural depth for Lexical. */
const LIST_INDENT_SIZE = 4

/** One source list item that remains open while consecutive lines import. */
interface OpenItem {
  readonly contentColumn: number
  readonly indent: number
}

/** Import context is editor-local: transformer objects are shared globally. */
interface ImportState {
  readonly listKey: string
  readonly open: readonly OpenItem[]
}

const importState = new WeakMap<LexicalEditor, ImportState>()

interface ResolvedItem {
  readonly contentPrefix: string
  readonly open: OpenItem[]
}

/** CommonMark expands tabs at four-column stops for block structure. */
function columnAfter(text: string, from = 0): number {
  let column = from
  for (const character of text) {
    column = character === '\t' ? column + (4 - (column % 4)) : column + 1
  }
  return column
}

/** The previous non-empty block; blank lines may only make a list loose. */
function previousBlock(node: LexicalNode): LexicalNode | null {
  let sibling = node.getPreviousSibling()
  while ($isParagraphNode(sibling) && sibling.getTextContentSize() === 0) {
    sibling = sibling.getPreviousSibling()
  }
  return sibling
}

function carriedOpenItems(parentNode: ElementNode): readonly OpenItem[] {
  const previous = previousBlock(parentNode)
  if (!$isListNode(previous)) return []
  const state = importState.get($getEditor())
  return state?.listKey === previous.getKey() ? state.open : []
}

/** Extend the open-item stack with the current source line. */
function resolveOpenItems(
  parentNode: ElementNode,
  children: readonly LexicalNode[],
  match: string[],
  spec: ListSpec,
): ResolvedItem | null {
  const open = [...carriedOpenItems(parentNode)]
  const column = columnAfter(match[1] ?? '')
  let parent = open.at(-1)
  while (parent !== undefined && column < parent.contentColumn) {
    open.pop()
    parent = open.at(-1)
  }

  // A list marker may be indented by at most three columns within its current
  // container. At four it is block content (usually indented code), not a
  // deeper list item.
  const containerColumn = parent?.contentColumn ?? 0
  if (column > containerColumn + 3) return null

  const markerEnd = column + spec.markerWidth(match)
  const paddingEnd = columnAfter(spec.padding(match), markerEnd)
  const paddingColumns = paddingEnd - markerEnd
  if (paddingColumns > 4 && !spec.acceptsIndentedCode) return null

  const first = children[0]
  const startsBlank =
    spec.emptyItemUsesSinglePadding && $isTextNode(first) && first.getTextContentSize() === 0

  // In the ordinary case CommonMark consumes all one-to-four padding columns.
  // With more than four, the item starts with indented code: only one column
  // belongs to the list prefix and the remainder stays in the item content.
  const contentColumn = startsBlank || paddingColumns > 4 ? markerEnd + 1 : paddingEnd
  const contentPrefix = !startsBlank && paddingColumns > 4 ? ' '.repeat(paddingColumns - 1) : ''
  open.push({
    contentColumn,
    indent: parent === undefined ? 0 : parent.indent + 1,
  })
  return { contentPrefix, open }
}

/** Shortcut-time indent fallback. Imports use the CommonMark stack above. */
function getShortcutIndent(whitespaces: string): number {
  const tabs = whitespaces.match(/\t/g)
  const spaces = whitespaces.match(/ /g)
  return (tabs === null ? 0 : tabs.length) + (spaces === null ? 0 : Math.floor(spaces.length / 4))
}

/** How one list flavour reads its own matched line. Group numbering is this
 * module's own, since it owns both the patterns and the reader. */
interface ListSpec {
  readonly listType: ListType
  /** Width of the bullet or ordered marker, excluding its following padding. */
  readonly markerWidth: (match: string[]) => number
  /** Whitespace between the list marker and the first item-content token. */
  readonly padding: (match: string[]) => string
  /** Whether padding beyond four columns denotes an indented-code list item. */
  readonly acceptsIndentedCode: boolean
  /** Empty bullet/ordered items use CommonMark's marker-width-plus-one rule. */
  readonly emptyItemUsesSinglePadding: boolean
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

    const container = parentNode.getParent()
    const resolved = isImport ? resolveOpenItems(parentNode, children, match, spec) : null
    if (isImport && resolved === null) {
      const first = children[0]
      if ($isTextNode(first)) first.setTextContent((match[0] ?? '') + first.getTextContent())
      return false
    }
    const indent = resolved?.open.at(-1)?.indent ?? getShortcutIndent(match[1] ?? '')
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

    const first = children[0]
    if (resolved?.contentPrefix && $isTextNode(first)) {
      first.setTextContent(resolved.contentPrefix + first.getTextContent())
    }
    listItem.append(...children)
    if (!isImport) listItem.select(0, 0)
    if (indent) listItem.setIndent(indent)

    if (resolved !== null) {
      const list = container?.getLastChild()
      if ($isListNode(list)) {
        importState.set($getEditor(), { listKey: list.getKey(), open: resolved.open })
      } else importState.delete($getEditor())
    }
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
  regExp: /^([ \t]*)([-*+])([ \t]+)/,
  replace: listReplace({
    listType: 'bullet',
    markerWidth: () => 1,
    padding: (match) => match[3] ?? '',
    acceptsIndentedCode: true,
    emptyItemUsesSinglePadding: true,
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
  regExp: /^([ \t]*)(\d{1,9})([.)])([ \t]+)/,
  replace: listReplace({
    listType: 'number',
    markerWidth: (match) => (match[2]?.length ?? 0) + 1,
    padding: (match) => match[4] ?? '',
    acceptsIndentedCode: true,
    emptyItemUsesSinglePadding: true,
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
  regExp: /^([ \t]*)(?:([-*+])([ \t]+))?(\[([\sxX]?)\])([ \t])/,
  replace: listReplace({
    listType: 'check',
    markerWidth: () => 1,
    padding: (match) => (match[2] === undefined ? ' ' : (match[3] ?? '')),
    acceptsIndentedCode: false,
    emptyItemUsesSinglePadding: false,
    marker: (match) => asListMarker(match[2]),
    checked: (match) => isCheckedMarker(match[5]),
  }),
  triggerOnEnter: true,
  type: 'element',
}
