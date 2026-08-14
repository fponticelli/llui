// A marker-aware `ListNode` — the node half of issue #129.
//
// ## Why a node subclass is unavoidable here
//
// CommonMark 0.31 §5.3: "Changing the bullet or ordered list delimiter starts a
// new list." `- a` then `* b` is two lists. A blank line between items of the
// SAME marker only makes the list LOOSE — it does not split it — so a marker
// change is the ONLY way CommonMark can express two adjacent lists at all. An
// editor that cannot round-trip one therefore has no valid serialization for
// that document.
//
// The obvious place to fix that is the markdown importer, and it is not enough.
// Two adjacent same-type lists cannot survive in a stock Lexical tree AT ALL,
// no matter who built them: `ListNode`'s own `$config().$transform` calls
// `mergeNextSiblingListIfSameType`, which merges any two adjacent lists whose
// `listType` matches — and `-`, `*` and `+` all map to `bullet`. Build two by
// hand, in a headless editor, with no markdown involved, and they are one list
// by the end of the update. Re-splitting them from a second transform is not an
// option either: upstream would merge them again on the next pass, and the
// transform loop would never reach a fixed point.
//
// So the marker has to be part of the merge decision, and the merge decision
// lives in a transform this package can only replace by owning the node. A
// subclass whose own `$config()` declares `extends: ElementNode` skips
// `ListNode`'s config entirely — `iterStaticNodeConfigChain` follows the
// declared `extends` in preference to the prototype chain — which is what takes
// the unconditional merge out of the picture. That also drops everything else
// that config carried. Only ONE of those needs restoring: the ordered-value
// bookkeeping, re-implemented below. Its `importDOM` does NOT — see `$config()`.
//
// The alternative worth recording, because it is the one a fresh reader
// re-derives: store the marker PER ITEM and split at export instead of keeping
// two lists in the tree. It fails #129's first two acceptance criteria
// literally — both are stated over the node tree ("`- a` then `* b` imports as
// TWO lists"), and one list carrying two markers is one list however it
// serializes.
//
// `$createListNode` is redirected onto this class by the `{replace, with,
// withKlass}` entry in {@link MARKDOWN_LIST_NODES}, so every list in the editor
// — typed, imported, pasted, or made by `INSERT_UNORDERED_LIST_COMMAND` — is a
// `MarkdownListNode`. Nothing else in the package needs to know: `$isListNode`
// and `$getNearestNodeOfType(…, ListNode)` are `instanceof` checks that a
// subclass satisfies.
//
// If Lexical ever makes the sibling merge marker-aware (or lets a node opt out
// of the transform), delete this module and go back to the stock `ListNode`.

import {
  $getState,
  $setState,
  createState,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type LexicalNodeConfig,
} from 'lexical'
import { $isListItemNode, $isListNode, ListNode } from '@lexical/list'

/** The character a list was authored with: a bullet (`-`/`*`/`+`) or an ordered
 * delimiter (`.`/`)`). Both are "the marker" for CommonMark's purposes — §5.3
 * gives them the same rule. */
export type ListMarker = '-' | '*' | '+' | '.' | ')'

const MARKERS: readonly ListMarker[] = ['-', '*', '+', '.', ')']

/** Narrow an unknown to a {@link ListMarker}, or `null`. `find` keeps this a
 * lookup rather than a cast: the element type IS `ListMarker`. */
export function asListMarker(value: unknown): ListMarker | null {
  return MARKERS.find((marker) => marker === value) ?? null
}

/**
 * The authored marker, or `null` for a list nobody spelled one for — a list
 * made by the toolbar, by `INSERT_UNORDERED_LIST_COMMAND`, or pasted as HTML.
 *
 * `null` is not the same as `'-'`, and the difference is what keeps the split
 * rule from firing where no author ever changed a marker: an unspelled list
 * merges with anything of its type and adopts that list's marker.
 */
const markerState = createState('lluiListMarker', {
  parse: asListMarker,
  resetOnCopyNode: true,
})

/** Either list class. `MarkdownListNode` IS a `ListNode` at runtime, but Lexical
 * encodes a node's config chain in its `$config()` return type, and this node
 * deliberately declares a different one — so the two are not assignable to each
 * other and a helper that takes both has to say so. */
export type AnyListNode = ListNode | MarkdownListNode

/** A list that remembers the character it was authored with. */
export class MarkdownListNode extends ListNode {
  // `extends: ElementNode` is the whole point: `iterStaticNodeConfigChain`
  // follows a config's declared `extends` in preference to the prototype chain,
  // so declaring `ElementNode` is what takes `ListNode`'s config — and with it
  // the unconditional adjacent-list merge — out of this node's chain.
  //
  // That is also precisely what TypeScript objects to. Lexical encodes the
  // config chain in the `$config()` RETURN TYPE (a `STATIC_NODE_TYPE` accessor
  // accumulated through `extends`), so a subclass that declares an `extends`
  // other than its real superclass returns a record that is not assignable to
  // the superclass's. The divergence is the feature, and it is the only lever
  // the runtime offers — there is no way to unregister a transform a registered
  // node's `$config` contributes.
  //
  // The suppression is narrow and self-policing: if Lexical ever makes this
  // assignable the directive itself becomes an error, and if Lexical ever stops
  // honouring a declared `extends` the #129 cases in
  // `test/list-import.test.ts` fail loudly rather than silently.
  // @ts-expect-error — deliberate config-chain divergence; see above.
  // No `importDOM` here. Skipping `ListNode`'s config does skip its `ul`/`ol`
  // conversions, but re-declaring them is DEAD CODE: `initializeConversionCache`
  // (`LexicalEditor.ts:830-860`) harvests `importDOM` from EVERY registered
  // klass, and `MARKDOWN_LIST_NODES` registers the stock `ListNode` too — so the
  // conversions are cached either way, and `$convertListNode` calls
  // `$createListNode`, which the replacement redirects to `md-list`. Deleting a
  // re-declaration changed nothing in an HTML `<ul>`/`<ol>` paste; the property
  // that actually matters is pinned by `test/list-internals.test.ts`.
  $config() {
    return this.config('md-list', {
      $transform: $reconcileMarkdownList,
      extends: ElementNode,
    })
  }

  getMarker(): ListMarker | null {
    return $getState(this, markerState)
  }

  setMarker(marker: ListMarker | null): this {
    return $setState(this, markerState, marker)
  }
}

export function $isMarkdownListNode(
  node: LexicalNode | null | undefined,
): node is MarkdownListNode {
  return node instanceof MarkdownListNode
}

/**
 * Two lists may be joined when they are the same `listType` and no AUTHOR ever
 * distinguished them. Two spelled markers that differ is precisely CommonMark's
 * "a new list starts here"; anything else (either side unspelled) merges, and
 * the spelled marker wins.
 */
function canJoinLists(list: MarkdownListNode, next: MarkdownListNode): boolean {
  if (list.getListType() !== next.getListType()) return false
  const marker = list.getMarker()
  const nextMarker = next.getMarker()
  return marker === null || nextMarker === null || marker === nextMarker
}

/**
 * Append `list2`'s children to `list1` and drop `list2`, splicing a nested list
 * at the seam into the one before it so a merge does not leave two sibling
 * sublists inside adjacent items. (A port of `@lexical/list`'s unexported
 * `mergeLists`, which this node's transform replaces.)
 */
function $mergeLists(list1: AnyListNode, list2: AnyListNode): void {
  const lastOfFirst = list1.getLastChild()
  const firstOfSecond = list2.getFirstChild()
  if ($isListItemNode(lastOfFirst) && $isListItemNode(firstOfSecond)) {
    const nestedA = lastOfFirst.getFirstChild()
    const nestedB = firstOfSecond.getFirstChild()
    if ($isListNode(nestedA) && $isListNode(nestedB)) {
      $mergeLists(nestedA, nestedB)
      firstOfSecond.remove()
    }
  }
  const toMerge = list2.getChildren()
  if (toMerge.length > 0) list1.append(...toMerge)
  list2.remove()
}

/**
 * Give every item the ordinal it should carry, and clear a stray `checked` on a
 * list that is not a check list. (A port of `@lexical/list`'s unexported
 * `updateChildrenListItemValue`, for the same reason as {@link $mergeLists}.)
 */
function $updateChildrenListItemValue(list: AnyListNode): void {
  const isNotChecklist = list.getListType() !== 'check'
  let value = list.getStart()
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) continue
    if (child.getValue() !== value) child.setValue(value)
    if (isNotChecklist && child.getChecked() !== undefined) child.setChecked(undefined)
    // An item that only holds a nested list is not itself numbered.
    if (!$isListNode(child.getFirstChild())) value++
  }
}

/** This node's `$transform`: `ListNode`'s job, with the merge made marker-aware. */
function $reconcileMarkdownList(node: MarkdownListNode): void {
  const next = node.getNextSibling()
  if ($isMarkdownListNode(next) && canJoinLists(node, next)) {
    if (node.getMarker() === null) node.setMarker(next.getMarker())
    $mergeLists(node, next)
  }
  $updateChildrenListItemValue(node)
}

/**
 * Replace a stock `ListNode` with a `MarkdownListNode` the first time the
 * document touches it, so a list that never went through `$createListNode`
 * cannot keep the merging transform.
 *
 * The registration IS the back-compat half's other end. `MARKDOWN_LIST_NODES`
 * keeps stock `ListNode` registered so JSON written before this node existed
 * still loads — but `$parseSerializedNodeImpl` (`LexicalUpdates.ts:433`) calls
 * `nodeClass.importJSON` with NO replacement resolution, so that JSON, and any
 * CRDT document created by an older build, yields a GENUINE stock `ListNode`
 * carrying `ListNode.$config().$transform`. Without this the #129 guarantee
 * held only for documents created after the fix — the opposite of the ones the
 * issue was reported from.
 *
 * The upgrade is on TOUCH, and the window that leaves open is ONE MICROTASK —
 * not "until the user edits". `registerNodeTransform` itself calls
 * `markNodesWithTypesAsDirty` (`LexicalEditor.ts:1545`), which dirties every
 * already-loaded node of the registered types in an `editor.update` of its own,
 * so both registration orders converge: `setEditorState` THEN register gives
 * `list` synchronously and `md-list` after one microtask; register THEN
 * `setEditorState` gives `md-list` immediately. That holds for a non-editable
 * editor and for a list nobody ever edits, too.
 *
 * What it CANNOT do is pre-empt a stock node's OWN merging transform inside the
 * update that first dirties it. A stock `ListNode` arriving BETWEEN two settled
 * `md-list`s in a live update — exactly what `@lexical/yjs` produces, since
 * `Utils.ts:409` builds from `registeredNodes.get(type)` with the same absent
 * replacement resolution, so an older build feeds stock nodes into LIVE updates
 * and not only at load — runs `mergeNextSiblingListIfSameType` first:
 * `md-list/mk=-(a)` + stock `b` + `md-list/mk=*(c)` settles as one
 * `md-list/mk=-(a|b|c)` and the `-`/`*` boundary is gone. That is identical to
 * pre-#129 behaviour (stock merges all three as well), so it is not a
 * regression — but the #129 guarantee does NOT extend to a live collab document
 * mixing old and new builds. It is not closable from userland; #154 tracks the
 * two upstream levers that would close it.
 *
 * Register it wherever `MARKDOWN_LIST_NODES` is registered; `corePlugin` does.
 */
export function registerListNodeUpgrade(editor: LexicalEditor): () => void {
  return editor.registerNodeTransform(ListNode, (node: ListNode): void => {
    // `registerNodeTransform` also binds the listener to `replaceWithKlass`
    // (`LexicalEditor.ts:1533-1543`), so this same function runs for every
    // `MarkdownListNode` as well. Without the no-op it would replace its own
    // output on every pass and trip Lexical's infinite-transform invariant.
    if ($isMarkdownListNode(node)) return
    const upgraded = new MarkdownListNode(node.getListType(), node.getStart())
    // `exportJSON`/`updateFromJSON` rather than a hand-written property list:
    // it carries format, indent, direction, text format/style and node state
    // as one unit, and cannot fall behind a future `ListNode` field. Children
    // are `[]` in the export and move across via `replace(…, true)`.
    upgraded.updateFromJSON(node.exportJSON())
    node.replace(upgraded, true)
  })
}

/**
 * The node registrations a marker-aware editor needs: the stock `ListNode`
 * (which the replacement is keyed on and which still deserializes any document
 * saved before this existed — see `registerListNodeUpgrade` above for what has
 * to happen to such a node next), this subclass, and the redirect that makes
 * `$createListNode` — and therefore every list command, transformer and DOM
 * conversion in `@lexical/list` — produce the subclass.
 */
export const MARKDOWN_LIST_NODES: readonly LexicalNodeConfig[] = [
  ListNode,
  MarkdownListNode,
  {
    replace: ListNode,
    with: (node: ListNode): MarkdownListNode =>
      new MarkdownListNode(node.getListType(), node.getStart()),
    withKlass: MarkdownListNode,
  },
]
