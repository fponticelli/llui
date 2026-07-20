/**
 * Outbound sync: a Lexical `EditorState` → the Loro mirror.
 *
 * ── What this must get right ───────────────────────────────────────────────
 *
 * Converging is the easy half. The hard requirement is emitting a MINIMAL,
 * IDENTITY-PRESERVING op set, because in this stack a container that is
 * recreated instead of updated has visible, expensive consequences:
 *
 *  - a recreated `LoroText` discards a peer's concurrent insertion into it;
 *  - a recreated element `LoroMap` mints a new `ContainerID`, which (via the
 *    registry in `mapping.ts`) forces the peer's whole subtree to be rebuilt
 *    with fresh `NodeKey`s — tearing down every mounted `LLuiDecoratorNode`
 *    sub-app in it (`packages/lexical/src/decorator.ts` disposes on the
 *    'destroyed' mutation) along with selection and IME state.
 *
 * So: a reorder emits ONE `pos` register write per displaced block (never a
 * delete+recreate — see `order.ts` and the schema header), text edits emit a
 * cursor-biased single-region diff, and format changes emit explicit per-format
 * `mark`/`unmark` ops. Every function here returns the number of writes it made,
 * and `syncLexicalToLoro` returns the total — the tests assert on it, which is
 * how a regression in the pruning shows up as a failure rather than as a
 * silently slower, mount-destroying binding.
 *
 * ── Pruning: what is actually sound in Lexical ─────────────────────────────
 *
 * loro-prosemirror prunes with reference equality because ProseMirror's tree is
 * PERSISTENT: changing a leaf rebuilds every ancestor, so `parent === parent`
 * really does mean "this whole subtree is unchanged".
 *
 * LEXICAL IS NOT LIKE THAT, and assuming it is produces permanently stale
 * remote documents. `getWritable()` (`LexicalNode.ts`) clones ONLY the node
 * being written; ancestors are left alone and merely recorded in
 * `dirtyElements` by `internalMarkParentElementsAsDirty` (`LexicalUtils.ts`).
 * A paragraph whose text node was just rewritten is therefore the SAME object
 * in both editor states. Reference equality prunes a subtree in ProseMirror; in
 * Lexical it proves only that the node's OWN properties and its OWN child list
 * are unchanged.
 *
 * This module therefore uses two different, individually sound facts:
 *
 *  1. `prevNodeMap.get(key) === node` ⟹ this node's props and the identity and
 *     order of its children are unchanged. Used to skip the prop diff and the
 *     whole children RECONCILIATION (matching, deletes, moves, inserts) and
 *     descend positionally instead. Sound because any child list change goes
 *     through the parent's `getWritable()`.
 *  2. `dirtyElements ∪ dirtyLeaves` contains every changed node AND every
 *     ancestor of one. Used to decide which children to descend into at all.
 *     Sound because `internalMarkNodeAsDirty` walks the parent chain to the
 *     root.
 *
 * Fact 2 only holds when a dirty walk actually ran. `editor.setEditorState()`
 * — which Lexical's own history uses for undo/redo, and which the LLui host
 * push path uses — swaps the state wholesale with EMPTY dirty sets while
 * potentially SHARING node objects with the previous state. Trusting empty
 * dirty sets there would silently sync nothing. So when both sets are empty the
 * dirty gate is dropped entirely and the walk falls back to a full structural
 * diff against Loro, which is correct regardless of provenance and costs only
 * on that rare path. Combined, a keystroke costs O(tree depth); a wholesale
 * state swap costs O(document) and still emits only the ops that differ.
 *
 * ── Echo suppression ───────────────────────────────────────────────────────
 *
 * This is layer (b) of the three: an update we ourselves wrote back into
 * Lexical carries `COLLABORATION_TAG` and must not bounce back out. See
 * `index.ts` for the full three-layer contract — in particular that this
 * binding must NEVER emit `PROGRAMMATIC_TAG`.
 *
 * `HISTORIC_TAG` is deliberately NOT suppressed, and must stay that way — even
 * though this binding DOES ship CRDT-aware undo. The reason it can be left
 * unsuppressed is that the Loro undo owner (`undo.ts`) never routes through
 * Lexical's history: `manager.undo()` mutates the shared document directly, and
 * the resulting writeback into the editor carries `COLLABORATION_TAG` (echo
 * layer b), not `HISTORIC_TAG`. So the CRDT undo path emits no historic update
 * for this module to see. `lexicalForeign` also forces `@lexical/history` off
 * whenever `externalUndo` is present, so a shipped app produces no `HISTORIC_TAG`
 * update at all. Suppressing it here would be inert in that configuration and
 * actively WRONG for a host that deliberately runs `@lexical/history` without an
 * `externalUndo` owner (as `test/harden.test.ts` does): there a historic update
 * is a genuine local edit no peer has seen, and dropping it would make that
 * undo invisible to everyone else. This differs from `@lexical/yjs`, where undo
 * IS a historic writeback of the CRDT's own and re-syncing it would echo.
 */

import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  SKIP_COLLAB_TAG,
  type EditorState,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
  type NodeMap,
  type TextNode,
  type UpdateListenerPayload,
} from 'lexical'
import { LoroText, type ContainerID, type LoroDoc } from 'loro-crdt'

import { ContainerNodeMap } from './mapping.js'
import { allocate, jitterFor } from './order.js'
import {
  containerId,
  containerIsLive,
  createElementChild,
  createTextChild,
  deleteChild,
  elementChildren,
  elementProps,
  elementType,
  isTextContainer,
  newUuid,
  orderedChildren,
  setChildPosition,
  type ChildContainer,
  type ChildEntry,
  type ChildrenContainer,
  type ElementContainer,
  type PropValue,
} from './schema.js'
import {
  applyMarkOps,
  applyTextDiff,
  diffRunFormats,
  diffText,
  diffTextWithCursor,
  normalizeRuns,
  runsFromText,
  runsText,
} from './text.js'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Commit origin stamped on every write this module makes. */
export const OUTBOUND_ORIGIN = 'lexical-loro'

/**
 * Update tags that mean "this update did not originate with the local user, do
 * not mirror it".
 *
 * `COLLABORATION_TAG` is our own inbound writeback (echo layer b);
 * `SKIP_COLLAB_TAG` is Lexical's standard opt-out, which hosts use for local-only
 * decoration. `HISTORIC_TAG` is NOT here — see the file header.
 */
export const OUTBOUND_SKIP_TAGS: readonly string[] = [COLLABORATION_TAG, SKIP_COLLAB_TAG]

/** The Loro side of the binding: the document, its root mirror, and the registry. */
export interface OutboundTarget {
  readonly doc: LoroDoc
  /** The root element container, as returned by `initDoc`. */
  readonly root: ElementContainer
  /** The ContainerID ↔ NodeKey registry, owned by the binding and mutated here. */
  readonly mapping: ContainerNodeMap
  /** Commit origin. Defaults to {@link OUTBOUND_ORIGIN}. */
  readonly origin?: string
  /** Tags that suppress the sync. Defaults to {@link OUTBOUND_SKIP_TAGS}. */
  readonly skipTags?: readonly string[]
}

/**
 * The slice of `UpdateListenerPayload` this direction consumes. Declared as a
 * `Pick` so an update listener can pass its payload straight through.
 *
 * Register it with a BLOCK body, never an expression body:
 *
 * ```ts
 * editor.registerUpdateListener((payload) => {
 *   syncLexicalToLoro(target, payload)
 * })
 * ```
 *
 * Lexical 0.48 stores whatever an update listener RETURNS and calls it as a
 * cleanup before the next invocation (`triggerListeners` in `LexicalUpdates`),
 * so the concise `(payload) => syncLexicalToLoro(target, payload)` hands it this
 * function's op count and the second update dies with
 * "unregister is not a function".
 */
export type OutboundUpdate = Pick<
  UpdateListenerPayload,
  'prevEditorState' | 'editorState' | 'dirtyElements' | 'dirtyLeaves' | 'normalizedNodes' | 'tags'
>

/**
 * Mirror one Lexical update into the Loro document and commit it.
 *
 * @returns the number of Loro write operations emitted. `0` means the update
 * was a genuine no-op for the shared document — nothing was committed, so no
 * peer sees an event. Tests assert on this to catch pruning regressions.
 */
export function syncLexicalToLoro(target: OutboundTarget, update: OutboundUpdate): number {
  const skipTags = target.skipTags ?? OUTBOUND_SKIP_TAGS
  for (const tag of skipTags) {
    if (update.tags.has(tag)) return 0
  }

  // Lexical normalizes (merges/splits) adjacent TextNodes behind our back and
  // reports the casualties here. A merged-away key still in the registry would
  // make a later lookup resolve to a node that no longer exists, so drop them
  // before the walk; the walk re-links every run anchor it visits.
  for (const key of update.normalizedNodes) target.mapping.unlinkNode(key)

  // Empty dirty sets mean no dirty walk ran (a wholesale state swap), so they
  // cannot be trusted as a prune gate — see the file header.
  const dirty =
    update.dirtyElements.size > 0 || update.dirtyLeaves.size > 0
      ? new Set<NodeKey>([...update.dirtyElements.keys(), ...update.dirtyLeaves])
      : null

  return walk(target, update.editorState, update.prevEditorState._nodeMap, dirty)
}

/**
 * Fill the Loro document from an editor state with no previous state to diff
 * against — the bootstrapping peer's initial seed.
 *
 * Structurally a full-fidelity diff, so it is also idempotent: seeding a
 * document that already matches emits nothing and returns `0`.
 */
export function seedLoroFromLexical(target: OutboundTarget, editorState: EditorState): number {
  return walk(target, editorState, null, null)
}

// ---------------------------------------------------------------------------
// Walk context
// ---------------------------------------------------------------------------

/** The caret, resolved once per update, used to disambiguate text diffs. */
interface Caret {
  readonly key: NodeKey
  readonly offset: number
}

interface Context {
  readonly doc: LoroDoc
  readonly mapping: ContainerNodeMap
  /** `null` on a seed: nothing may be pruned by node identity. */
  readonly prevNodeMap: NodeMap | null
  /** `null` when the dirty sets are untrustworthy: descend everywhere. */
  readonly dirty: Set<NodeKey> | null
  /**
   * This peer's fractional-index jitter digit, derived from the Loro peer id.
   *
   * Applied only to multi-child BATCHES, which is what stops two peers' pastes
   * at the same spot from interleaving pairwise. See constraints 1 and 2 in
   * `order.ts`.
   */
  readonly jitter: string
  /** Resolved inside the state read, before the walk starts. */
  caret: Caret | null
  /** Loro writes emitted so far. */
  ops: number
  /** Set when a container was deleted, so the registry is swept once at the end. */
  removed: boolean
}

function walk(
  target: OutboundTarget,
  editorState: EditorState,
  prevNodeMap: NodeMap | null,
  dirty: Set<NodeKey> | null,
): number {
  const context: Context = {
    doc: target.doc,
    mapping: target.mapping,
    prevNodeMap,
    dirty,
    jitter: jitterFor(target.doc.peerId),
    caret: null,
    ops: 0,
    removed: false,
  }

  editorState.read(() => {
    const root = $getRoot()
    context.caret = readCaret()
    target.mapping.link(containerId(target.root), root.getKey())
    syncElement(target.root, root, context)
  })

  if (context.removed) {
    const nodeMap = editorState._nodeMap
    target.mapping.sweep({
      hasContainer: (id) => containerIsLive(target.doc, id),
      hasNode: (key) => nodeMap.has(key),
    })
  }

  if (context.ops > 0) target.doc.commit({ origin: target.origin ?? OUTBOUND_ORIGIN })
  return context.ops
}

/** The collapsed-or-focus caret, if it sits in a text node. */
function readCaret(): Caret | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  const focus = selection.focus
  if (focus.type !== 'text') return null
  return { key: focus.key, offset: focus.offset }
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/** Lexical node props that are structure or bookkeeping, never document data. */
const NON_PROP_KEYS: ReadonlySet<string> = new Set(['type', 'version', 'children'])

/**
 * Mirror one Lexical node into its element container.
 *
 * @param fresh whether `container` was JUST created and is therefore empty.
 *
 * ── Why `fresh` cannot be inferred ─────────────────────────────────────────
 *
 * The `unchanged` fast path below rests on `prevNodeMap`, which is a fact about
 * the LEXICAL side only: it says this node object was not rewritten in this
 * update. It says NOTHING about whether the Loro container already mirrors it.
 *
 * `insertChild` builds a brand-new, EMPTY container and populates it through
 * this function — and it does so precisely in the cases where Lexical did not
 * touch the node (a remote peer deleted the container, or it was tombstoned by a
 * concurrent delete+move, so the mirror must be rebuilt beneath an untouched
 * subtree). There, `unchanged` is true and skipping `syncProps` leaves the new
 * container's props map PERMANENTLY EMPTY: every peer's document agrees, so no
 * later batch repairs it, yet each peer's editor fills the missing keys with
 * whatever its local node happened to hold — identical documents, divergent
 * editors. Measured; see `test/convergence-attack.test.ts`.
 *
 * The registry cannot stand in for this flag either: `insertChild` links the new
 * ContainerID to the node before calling in, so a mapping check would report
 * "already mirrored" for exactly the containers that are not.
 */
function syncElement(
  container: ElementContainer,
  node: LexicalNode,
  context: Context,
  fresh = false,
): void {
  const unchanged =
    !fresh && context.prevNodeMap !== null && context.prevNodeMap.get(node.getKey()) === node

  if (!unchanged) syncProps(container, node, context)

  if (!$isElementNode(node)) {
    // A leaf mirrored as an element (LineBreakNode, LLuiDecoratorNode): its
    // payload lives entirely in `props`, and its `children` list stays empty.
    return
  }

  const current = orderedChildren(container)
  const desired = describeChildren(node)

  // `unchanged` proves the child list itself did not change, so the expensive
  // reconciliation (match / delete / re-position / insert) can be skipped
  // outright — but only when the dirty sets are trustworthy enough to tell us
  // which children still need descending into.
  if (unchanged && context.dirty !== null && current.length === desired.length) {
    if (descendUnchanged(current, desired, context)) return
  }

  reconcileChildren(container, current, desired, context)
}

function syncProps(container: ElementContainer, node: LexicalNode, context: Context): void {
  const props = elementProps(container)
  const json = node.exportJSON() as Record<string, unknown>
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(json)) {
    if (NON_PROP_KEYS.has(key) || value === undefined) continue
    seen.add(key)
    const next = toPropValue(key, value, node)
    if (jsonEqual(props.get(key), next)) continue
    props.set(key, next)
    context.ops++
  }

  for (const key of props.keys()) {
    if (seen.has(key)) continue
    props.delete(key)
    context.ops++
  }
}

/**
 * Narrow an `exportJSON` value to a storable {@link PropValue}.
 *
 * Lexical guarantees `exportJSON` is JSON-serializable, so anything that is not
 * is a bug in a custom node — surfaced loudly here rather than as a document
 * that silently fails to replicate.
 */
function toPropValue(key: string, value: unknown, node: LexicalNode): PropValue {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object': {
      if (Array.isArray(value))
        return value.map((item, i) => toPropValue(`${key}[${i}]`, item, node))
      const out: Record<string, PropValue> = {}
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (innerValue === undefined) continue
        out[innerKey] = toPropValue(`${key}.${innerKey}`, innerValue, node)
      }
      return out
    }
    default:
      throw new Error(
        `lexical-loro: ${node.getType()}.exportJSON() returned a non-JSON value at '${key}' ` +
          `(${typeof value}) — node props must be JSON-serializable to replicate`,
      )
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && jsonEqual(left[key], right[key]))
}

// ---------------------------------------------------------------------------
// Children: the desired shape
// ---------------------------------------------------------------------------

/**
 * What a Lexical element's children should look like in Loro: one entry per
 * non-text child, and one per MAXIMAL RUN of adjacent text nodes (the schema's
 * text unit — see `schema.ts`).
 */
type DesiredChild = DesiredText | DesiredElement

interface DesiredText {
  readonly kind: 'text'
  readonly nodes: readonly TextNode[]
  /**
   * The run's registry key: the first text node's `NodeKey`.
   *
   * A run has no single node to name it, so it is addressed by its FIRST node
   * and the inbound direction walks forward while `$isTextNode` to recover the
   * rest. The anchor is re-linked on every visit, which is what keeps it valid
   * across Lexical's normalization (which may destroy the previous anchor).
   */
  readonly anchor: NodeKey
}

interface DesiredElement {
  readonly kind: 'element'
  readonly node: LexicalNode
  readonly key: NodeKey
}

function describeChildren(node: ElementNode): DesiredChild[] {
  const out: DesiredChild[] = []
  let run: TextNode[] = []
  const flush = (): void => {
    if (run.length === 0) return
    out.push({ kind: 'text', nodes: run, anchor: run[0]!.getKey() })
    run = []
  }
  for (const child of node.getChildren()) {
    if ($isTextNode(child)) {
      run.push(child)
    } else {
      flush()
      out.push({ kind: 'element', node: child, key: child.getKey() })
    }
  }
  flush()
  return out
}

/** The registry key a desired child is addressed by. */
function desiredKey(child: DesiredChild): NodeKey {
  return child.kind === 'text' ? child.anchor : child.key
}

// ---------------------------------------------------------------------------
// Children: the unchanged-list fast path
// ---------------------------------------------------------------------------

/**
 * Descend into a child list that is known not to have changed shape, visiting
 * only what the dirty sets say could have changed.
 *
 * This is the typing path: a keystroke leaves every ancestor object identical,
 * so the whole reconciliation is skipped at every level and the walk costs
 * O(tree depth) rather than O(document).
 *
 * ── What "unchanged" does and does NOT prove ───────────────────────────────
 *
 * `unchanged` is a fact about the LEXICAL side only: this element's own child
 * list did not change between the two editor states. It says nothing about the
 * LORO side, which a peer can have restructured concurrently. So the fast path
 * must still verify, per child, that the container sitting at that index is the
 * one the registry already associates with this node — matching by POSITION
 * alone is only sound in a single-writer world.
 *
 * Skipping that check writes one node's content into a different node's
 * container. A randomized three-peer test caught the sharpest form: a remote
 * peer deleted one block and inserted another, leaving the child COUNT equal, so
 * every length check still passed while every index had shifted — and the local
 * peer's next keystroke was applied to a container the remote peer had deleted,
 * which loro-crdt rejects outright. Silent cross-writes would have been the
 * quieter, worse outcome.
 */
function descendUnchanged(
  current: readonly ChildEntry[],
  desired: readonly DesiredChild[],
  context: Context,
): boolean {
  for (let i = 0; i < desired.length; i++) {
    const child = desired[i]!
    const entry = current[i]!
    // The mirror disagrees with the fast path's premise; hand back to the
    // identity-matching reconciliation, which handles the remote change.
    if (!containerMatches(entry.container, child, context)) return false
    if (child.kind === 'text') {
      if (entry.kind !== 'text' || !isTextContainer(entry.container)) return false
      // The parent object is unchanged, so the run's COMPOSITION is unchanged;
      // per-node reference equality therefore proves the run is untouched.
      if (child.nodes.every((n) => context.prevNodeMap?.get(n.getKey()) === n)) continue
      context.mapping.link(containerId(entry.container), child.anchor)
      syncText(entry.container, child, context)
      continue
    }
    if (entry.kind !== 'element' || isTextContainer(entry.container)) return false
    if (context.dirty !== null && !context.dirty.has(child.key)) continue
    context.mapping.link(containerId(entry.container), child.key)
    syncElement(entry.container, child.node, context)
  }
  return true
}

/**
 * Whether `container` is the one the registry already addresses for `child`.
 *
 * An UNMAPPED child is a mismatch, not a match: the registry is the only
 * evidence that this position still means the same thing to both sides, and
 * guessing in its absence is what the fast path must never do.
 *
 * ── There is no tombstone check here any more, and none is needed ──────────
 *
 * Under the `LoroMovableList` schema this also had to reject TOMBSTONES:
 * containers still listed but deleted, produced when the list merged a
 * concurrent DELETE and MOVE of the same element by keeping the moved element
 * while the delete op marked the container deleted. loro-crdt then refused every
 * write to an entry `toArray()` still reported.
 *
 * The carrier schema cannot reach that state. A delete removes the carrier's key
 * from the `children` map outright, and a concurrent `pos` write does not
 * resurrect it — the key is absent from `keys()` on EVERY peer, symmetrically,
 * so there is nothing listed to write to. That is pinned by a test in
 * `test/schema.test.ts`; it is the reason `isDeleted()` no longer appears on any
 * outbound path.
 */
function containerMatches(
  container: ChildContainer,
  child: DesiredChild,
  context: Context,
): boolean {
  const mapped = context.mapping.containerId(desiredKey(child))
  return mapped !== undefined && mapped === containerId(container)
}

// ---------------------------------------------------------------------------
// Children: full reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile a child list: match survivors, delete the rest, RE-POSITION what
 * moved, create what is new, then descend.
 *
 * Matching is by IDENTITY, not by shape: an element child is matched through the
 * registry (`NodeKey` → `ContainerID`), which is what lets a drag-reorder be
 * recognised as a permutation rather than as a delete plus an insert. Text runs
 * have no durable identity of their own (Lexical splits and merges them freely),
 * so they are matched by ORDINAL among the text children — which keeps a run's
 * `LoroText` alive across a split, a merge, or a re-typed anchor, and so keeps a
 * peer's concurrent insertion into it.
 *
 * ── What replaced the movable-list machinery ───────────────────────────────
 *
 * This used to plan `LoroMovableList#move` ops, which meant simulating the
 * list's evolving indices (`live`), re-indexing survivors against the compacted
 * list, and converting each desired position into a from/to index pair. All of
 * that is gone: a position is now an ABSOLUTE, order-carrying string, so a child
 * is placed by writing one register and nothing else shifts.
 *
 * The longest-increasing-subsequence step SURVIVES, and deleting it would be a
 * real regression. Without it, every reorder would rewrite every sibling's
 * `pos`: O(n) ops instead of one, and — because a rewrite of the whole list is
 * exactly the rebalance that constraint 3 in `order.ts` forbids — it would
 * silently relocate any concurrent insert from another peer. With it, the
 * longest already-correctly-ordered run of survivors keeps its positions and
 * only genuinely displaced children are written.
 */
function reconcileChildren(
  element: ElementContainer,
  current: readonly ChildEntry[],
  desired: readonly DesiredChild[],
  context: Context,
): void {
  const children = elementChildren(element)
  const matched = matchChildren(current, desired, context)
  const survivors = new Set(matched.filter((entry): entry is ChildEntry => entry !== null))

  // A LoroText that is losing its last content is EMPTIED rather than deleted
  // when it would leave the element with no children at all. Deleting it would
  // discard a peer's concurrent insertion into that exact container; keeping an
  // empty run costs one dormant container and projects to zero text nodes.
  if (desired.length === 0 && current.length === 1 && current[0]!.kind === 'text') {
    const text = current[0]!.container
    if (isTextContainer(text)) {
      context.mapping.unlinkContainer(containerId(text))
      if (text.length > 0) {
        text.delete(0, text.length)
        context.ops++
      }
      return
    }
  }

  // 1. Delete unmatched survivors. Order is irrelevant — a carrier is addressed
  //    by uuid, so removing one cannot shift another.
  for (const entry of current) {
    if (survivors.has(entry)) continue
    context.mapping.unlinkContainer(containerId(entry.container))
    deleteChild(children, entry.uuid)
    context.ops++
    context.removed = true
  }

  // 2. Place everything: keep the already-ordered survivors, re-position the
  //    rest, and create what has no match.
  const placed = placeChildren(children, desired, matched, context)

  // 3. Descend. Newly created children were filled by `createChild`.
  for (let i = 0; i < desired.length; i++) {
    if (matched[i] === null) continue
    const child = desired[i]!
    const container = placed[i]!
    context.mapping.link(containerId(container), desiredKey(child))
    if (child.kind === 'text') {
      if (isTextContainer(container)) syncText(container, child, context)
    } else if (!isTextContainer(container)) {
      syncElement(container, child.node, context)
    }
  }
}

/**
 * Assign every desired child a position, creating the ones that have no
 * surviving carrier, and return the container now sitting at each index.
 *
 * The survivors whose positions are already in the desired relative order are
 * left completely untouched (see the LIS note on {@link reconcileChildren});
 * every other child is written into the gap between its nearest kept
 * neighbours, one maximal gap at a time so that a multi-child insertion is
 * allocated as ONE batch. Batching is what gives the run a peer-private
 * sub-interval and stops two concurrent pastes from interleaving — constraint 1
 * in `order.ts`.
 *
 * The kept positions are STRICTLY increasing (the subsequence is strict), so
 * every interval handed to `allocate` is non-degenerate and the equal-position
 * hazard of constraint 4 cannot arise on this path.
 */
function placeChildren(
  children: ChildrenContainer,
  desired: readonly DesiredChild[],
  matched: readonly (ChildEntry | null)[],
  context: Context,
): ChildContainer[] {
  const survivorIndices: number[] = []
  for (let i = 0; i < desired.length; i++) if (matched[i] !== null) survivorIndices.push(i)

  // LIS works on ranks so that two survivors sharing a position can never both
  // be kept — which is what keeps the intervals below strictly ordered.
  const ranks = positionRanks(survivorIndices.map((i) => matched[i]!.pos))
  const keep = new Set<number>()
  for (const index of longestIncreasingSubsequence(ranks)) keep.add(survivorIndices[index]!)

  const placed = new Array<ChildContainer>(desired.length)
  for (const index of keep) placed[index] = matched[index]!.container

  let i = 0
  while (i < desired.length) {
    if (keep.has(i)) {
      i++
      continue
    }
    let end = i
    while (end < desired.length && !keep.has(end)) end++
    // `i - 1` and `end` are kept (or out of range), so both bounds are the
    // positions of untouched survivors and `before < after` strictly.
    const before = i === 0 ? null : matched[i - 1]!.pos
    const after = end === desired.length ? null : matched[end]!.pos
    const keys = allocate(before, after, end - i, context.jitter)

    for (let j = i; j < end; j++) {
      const key = keys[j - i]!
      const entry = matched[j] ?? null
      if (entry === null) {
        placed[j] = createChild(children, desired[j]!, key, context)
        continue
      }
      setChildPosition(entry.carrier, key)
      context.ops++
      placed[j] = entry.container
    }
    i = end
  }

  return placed
}

/**
 * Dense ranks for a list of positions: equal positions share a rank.
 *
 * Sharing a rank is the point. `longestIncreasingSubsequence` is STRICT, so two
 * children that a concurrent insert left holding the same position can never
 * both be kept, and every interval derived from the kept set stays usable.
 */
function positionRanks(positions: readonly string[]): number[] {
  const distinct = [...new Set(positions)].sort()
  const rank = new Map(distinct.map((pos, index) => [pos, index]))
  return positions.map((pos) => rank.get(pos)!)
}

/**
 * For each desired child, the existing carrier it reuses, or `null` when it
 * must be created.
 */
function matchChildren(
  current: readonly ChildEntry[],
  desired: readonly DesiredChild[],
  context: Context,
): (ChildEntry | null)[] {
  const byId = new Map<ContainerID, ChildEntry>()
  const textEntries: ChildEntry[] = []
  for (const entry of current) {
    if (entry.kind === 'text') textEntries.push(entry)
    else byId.set(containerId(entry.container), entry)
  }

  const matched = new Array<ChildEntry | null>(desired.length).fill(null)
  const claimed = new Set<ChildEntry>()
  let nextText = 0

  for (let i = 0; i < desired.length; i++) {
    const child = desired[i]!
    if (child.kind === 'text') {
      // Ordinal matching among text children: runs have no stable identity, but
      // their POSITION among the element's text runs is stable enough to keep
      // the container (and therefore concurrent remote edits to it) alive.
      const entry = textEntries[nextText]
      if (entry === undefined) continue
      nextText++
      matched[i] = entry
      claimed.add(entry)
      continue
    }
    const id = context.mapping.containerId(child.key)
    if (id === undefined) continue
    const entry = byId.get(id)
    if (entry === undefined || claimed.has(entry)) continue
    // A container that no longer mirrors this node's type (Lexical replaced the
    // node) must be rebuilt, not reused.
    if (isTextContainer(entry.container)) continue
    if (elementType(entry.container) !== child.node.getType()) continue
    matched[i] = entry
    claimed.add(entry)
  }
  return matched
}

/**
 * The indices of a longest strictly-increasing subsequence of `values`.
 *
 * Patience sorting with a predecessor chain: O(n log n). Exported because it is
 * the part of the reorder planner worth testing in isolation — the number of
 * `pos` writes a drag-reorder costs is exactly `matched.length - lis.length`.
 */
export function longestIncreasingSubsequence(values: readonly number[]): number[] {
  if (values.length === 0) return []
  // `tails[l]` is the index of the smallest tail among increasing
  // subsequences of length l+1; `previous[i]` chains the reconstruction.
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)

  for (let i = 0; i < values.length; i++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (values[tails[mid]!]! < values[i]!) low = mid + 1
      else high = mid
    }
    if (low > 0) previous[i] = tails[low - 1]!
    tails[low] = i
  }

  const out = new Array<number>(tails.length)
  let cursor = tails[tails.length - 1]!
  for (let i = tails.length - 1; i >= 0; i--) {
    out[i] = cursor
    cursor = previous[cursor]!
  }
  return out
}

/**
 * Create, attach and fill a brand-new child at position `pos`.
 *
 * The uuid is minted with `crypto.randomUUID`, which is REQUIRED rather than
 * merely convenient: two peers minting the same uuid would collide on one slot
 * of the `children` map, and its last-writer-wins would silently discard a whole
 * block. See {@link newUuid}.
 */
function createChild(
  children: ChildrenContainer,
  child: DesiredChild,
  pos: string,
  context: Context,
): ChildContainer {
  context.ops++
  const uuid = newUuid()
  if (child.kind === 'text') {
    // The carrier attaches the LoroText as it creates it, so the text is a live
    // document container from the start — marks are document operations, and a
    // detached LoroText cannot carry them.
    const text = createTextChild(children, uuid, pos)
    context.mapping.link(containerId(text), child.anchor)
    syncText(text, child, context)
    return text
  }
  const element = createElementChild(children, uuid, pos, child.node.getType())
  context.mapping.link(containerId(element), child.key)
  // `fresh`: this container is empty, so the Lexical-side `unchanged` fast path
  // must not be allowed to skip populating it. See {@link syncElement}.
  syncElement(element, child.node, context, true)
  return element
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Replay a text run's RESULTING state into its `LoroText`: reconcile the
 * characters with a cursor-biased single-region diff, then replay the formats
 * Lexical actually produced as explicit per-format `mark`/`unmark` ops.
 *
 * The second step is not redundant with the first. Loro's `expand` rule cannot
 * reproduce Lexical's boundary behaviour for any table, uniform or per-format —
 * see `text.ts` and the 51 tests in `test/expand-semantics.test.ts`. Replaying
 * the resulting node state is what makes typing at the start of a formatted
 * run, and toggling a format at a collapsed caret, come out right.
 */
function syncText(text: LoroText, child: DesiredText, context: Context): void {
  const target = normalizeRuns(
    child.nodes.map((node) => ({ text: node.getTextContent(), format: node.getFormat() })),
  )
  const targetString = runsText(target)
  const currentString = text.toString()

  if (currentString !== targetString) {
    const cursor = runCaret(child, context)
    const diff =
      cursor === null
        ? diffText(currentString, targetString)
        : diffTextWithCursor(currentString, targetString, cursor)
    applyTextDiff(text, diff)
    if (diff.remove > 0) context.ops++
    if (diff.insert !== '') context.ops++
  }

  const ops = diffRunFormats(runsFromText(text), target)
  applyMarkOps(text, ops)
  context.ops += ops.length
}

/**
 * The caret's offset within a run, in UTF-16 code units, or `null` when the
 * caret is elsewhere.
 *
 * Without it a repeated-character insertion is placed at its leftmost possible
 * position instead of where the user typed, which drags every remote caret and
 * (through `expand`) can attach the wrong formatting.
 */
function runCaret(child: DesiredText, context: Context): number | null {
  const caret = context.caret
  if (caret === null) return null
  let offset = 0
  for (const node of child.nodes) {
    if (node.getKey() === caret.key) return offset + caret.offset
    offset += node.getTextContentSize()
  }
  return null
}
