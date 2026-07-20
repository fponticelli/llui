/**
 * Inbound sync: the Loro mirror → a Lexical `EditorState`.
 *
 * ── The one thing this must not do ─────────────────────────────────────────
 *
 * loro-prosemirror's inbound path replaces the whole document on every remote
 * event (`sync-plugin.ts`). ProseMirror tolerates that. LEXICAL CANNOT: its
 * `NodeKey` is a bare counter (`LexicalUtils.ts`: `'' + keyCounter++`), so a
 * rebuild mints a fresh key for every node, which tears down all DOM, destroys
 * the selection and IME composition, and — decisively for this stack — destroys
 * and remounts EVERY `LLuiDecoratorNode`, because `packages/lexical/decorator.ts`
 * disposes the mounted LLui sub-app on the 'destroyed' mutation.
 *
 * So this module is a PERSISTENT MIRROR: it resolves each remote change to an
 * existing `NodeKey` through the registry in `mapping.ts` and MUTATES THAT NODE
 * IN PLACE. Nodes nothing touched are never written, so their keys — and
 * therefore their DOM, their mounts, and any selection inside them — survive by
 * construction. That is the model `@lexical/yjs`'s `SyncEditorStates.ts` uses,
 * and it is the only one that works here.
 *
 * ── Why it reconciles from STATE, not from the deltas ──────────────────────
 *
 * The events say WHERE the document changed; this module then reconciles those
 * containers against Loro's CURRENT state rather than replaying each delta. Four
 * reasons, all learned from the event shapes loro-crdt actually emits:
 *
 *  1. A batch that creates a subtree emits the parent's list insert AND a
 *     separate event for every descendant container. Replaying all of them
 *     double-applies; reconciling from state is idempotent, so the duplicate
 *     descriptions of one change collapse to one reconciliation.
 *  2. A `LoroMovableList#move` arrives as an insert plus a delete carrying the
 *     SAME `ContainerID`. Reconciling by identity recognises that as a move —
 *     the whole point of the movable-list schema — where a delta replay would
 *     see a delete and rebuild the subtree.
 *  3. A map deletion is reported as an `undefined` value in `MapDiff.updated`,
 *     which is indistinguishable from an absent key in most JS handling. Reading
 *     the map is unambiguous.
 *  4. It is the mirror image of `to-loro.ts`, so both directions share one
 *     notion of "these two trees agree" (`text.ts`'s normalized runs) and cannot
 *     drift apart in their idea of what a difference is.
 *
 * The events are therefore used as a DIRTY SET, exactly as `to-loro.ts` uses
 * Lexical's `dirtyElements`/`dirtyLeaves`: every element on the path from the
 * root to a changed container is marked, and the walk descends only into marked
 * children. A remote keystroke costs O(tree depth), not O(document).
 *
 * ── Selection ──────────────────────────────────────────────────────────────
 *
 * Untouched nodes keep their keys, so a caret outside the changed run needs no
 * help at all. Only the case where a remote change lands INSIDE the exact text
 * run holding the caret needs work: there the caret's offset is transformed
 * through the same single-region diff used to update the run (a caret at or
 * before the edit point does not move; one after it shifts by
 * `insert.length - remove`; one inside a deleted span clamps to the edit point).
 * That is deliberately narrow — reaching for cursors more broadly would mean
 * writing selection on every remote event, which is its own source of jitter.
 */

import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $parseSerializedNode,
  $setSelection,
  COLLABORATION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type SerializedLexicalNode,
  type TextNode,
} from 'lexical'
import {
  LoroMap,
  type Container,
  type ContainerID,
  type LoroDoc,
  type LoroEventBatch,
} from 'loro-crdt'

import { ContainerNodeMap } from './mapping.js'
import {
  KEY_TYPE,
  containerId,
  containerIsLive,
  elementProps,
  elementType,
  isTextContainer,
  orderedChildren,
  type ChildContainer,
  type ElementContainer,
  type PropValue,
} from './schema.js'
import { diffTextWithCursor, normalizeRuns, runsFromText, runsText, type TextRun } from './text.js'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Tags stamped on every inbound writeback.
 *
 * `COLLABORATION_TAG` is echo layer (b): `to-loro.ts` skips updates carrying it,
 * so our own writeback cannot bounce back into the shared document.
 * `SKIP_SCROLL_INTO_VIEW_TAG` stops a peer's edit from yanking the local
 * viewport.
 *
 * `PROGRAMMATIC_TAG` is deliberately ABSENT and must stay that way — echo layer
 * (c). `packages/lexical/src/foreign.ts` treats that tag as "the host pushed new
 * content: cancel pending outbound work and rebase", so a remote writeback
 * carrying it would silently cancel the local user's in-flight debounced
 * `onChange` and the host's persistence would go dark whenever a peer types.
 */
export const INBOUND_TAGS: readonly string[] = [COLLABORATION_TAG, SKIP_SCROLL_INTO_VIEW_TAG]

/** The Lexical side of the binding, plus the shared document it mirrors. */
export interface InboundTarget {
  readonly doc: LoroDoc
  /** The root element container, as returned by `initDoc`. */
  readonly root: ElementContainer
  /** The ContainerID ↔ NodeKey registry, owned by the binding and mutated here. */
  readonly mapping: ContainerNodeMap
  readonly editor: LexicalEditor
  /**
   * Commit origins whose LOCAL batches must still be applied.
   *
   * Echo layer (a) drops `by: 'local'` batches — they are this peer's own
   * outbound writes coming back round. The exception is the CRDT-aware undo
   * manager (`undo.ts`): its `undo()`/`redo()` produce LOCAL batches that are NOT
   * echoes and MUST be applied, so `binding.ts` passes their origin
   * (`UNDO_ORIGINS`) here. A local batch whose origin is on this list is applied;
   * every other local batch is still dropped as an echo.
   */
  readonly undoOrigins?: readonly string[]
}

/**
 * Apply one Loro event batch to the editor.
 *
 * @returns whether anything was applied. `false` means the batch was an echo of
 * our own write, or described no change the editor could see.
 */
export function applyLoroToLexical(target: InboundTarget, batch: LoroEventBatch): boolean {
  // ── Echo layer (a) ──────────────────────────────────────────────────────
  // A local batch is this peer's own outbound write completing its commit. Our
  // outbound listener already produced it FROM the editor; feeding it back would
  // re-enter `editor.update` from inside a Lexical update listener.
  if (batch.by === 'local') {
    const origins = target.undoOrigins ?? []
    if (batch.origin === undefined || !origins.includes(batch.origin)) return false
  }
  if (batch.events.length === 0) return false

  const dirty = collectDirtyElements(target.doc, containerId(target.root), batch.events)
  return $applyReconciliation(target, dirty)
}

/**
 * Reconcile the ENTIRE shared document into the editor, with no dirty gate.
 *
 * Used at boot by a peer adopting a document it has no event history for (see
 * `seed.ts`), and as the fallback whenever an event's container ancestry cannot
 * be resolved. Full-fidelity and identity-preserving: adopting a document the
 * editor already matches writes nothing and churns no NodeKeys.
 */
export function adoptLoroDocument(target: InboundTarget): boolean {
  return $applyReconciliation(target, null)
}

// ---------------------------------------------------------------------------
// The dirty set
// ---------------------------------------------------------------------------

/**
 * Every element container on the path from the root to a container this batch
 * touched — the inbound analogue of Lexical's `dirtyElements`.
 *
 * The walk goes UP from each event target via `parent()`, so it needs no path
 * arithmetic and cannot be confused by indices that shifted within the batch.
 *
 * ── The fail-safe, and why it must be exactly this one ─────────────────────
 *
 * The gate is only sound if the editor already agreed with the document before
 * the batch: a child that is not marked is left ALONE, so a single event whose
 * location we resolve too narrowly leaves that subtree permanently stale, and
 * nothing later repairs it (no future batch will mention it either). A narrowed
 * dirty set is therefore not a small error — it is silent, unrecoverable
 * divergence.
 *
 * So anything less than a walk that terminates at the ROOT WE MIRROR returns
 * `null`, which drops the gate and falls back to a full structural pass —
 * correct regardless of provenance, at the cost of one O(document) walk. An
 * earlier version skipped events whose target reported `isDeleted()` instead,
 * and a randomized three-peer test caught it: a container one peer deletes and
 * another concurrently MOVES is resurrected by the merge, but reports itself
 * deleted to the peer that removed it, so its events were dropped and that
 * peer's editor silently stopped tracking the run for the rest of the session.
 */
function collectDirtyElements(
  doc: LoroDoc,
  rootId: ContainerID,
  events: LoroEventBatch['events'],
): Set<ContainerID> | null {
  const dirty = new Set<ContainerID>()
  for (const event of events) {
    let cursor: Container | undefined = doc.getContainerById(event.target)
    let reached = false
    while (cursor !== undefined) {
      // An element map is the only container carrying `type`; `props` maps and
      // `children` lists are addressed through the element that owns them.
      if (cursor instanceof LoroMap && cursor.get(KEY_TYPE) !== undefined) dirty.add(cursor.id)
      if (cursor.id === rootId) reached = true
      cursor = cursor.parent()
    }
    if (!reached) return null
  }
  return dirty
}

// ---------------------------------------------------------------------------
// The update
// ---------------------------------------------------------------------------

/** Everything the walk threads through itself. */
interface Context {
  readonly doc: LoroDoc
  readonly mapping: ContainerNodeMap
  /** `null` means "descend everywhere" — see {@link collectDirtyElements}. */
  readonly dirty: Set<ContainerID> | null
  /** Text points captured before the walk, to be re-placed after it. */
  readonly points: CapturedPoint[]
  /** Set when any Lexical node was written. */
  changed: boolean
  /** Set when a node was removed, so the registry is swept once at the end. */
  removed: boolean
}

/** A selection endpoint that sat in a text run, in run-absolute UTF-16 units. */
interface CapturedPoint {
  readonly point: PointType
  /** The keys of the text nodes forming the run this point sits in. */
  readonly runKeys: readonly NodeKey[]
  /** Offset from the START of the run, not of the individual node. */
  offset: number
  /** Set once the run is rebuilt: where the point must land. */
  resolved: { node: TextNode; offset: number } | null
}

function $applyReconciliation(target: InboundTarget, dirty: Set<ContainerID> | null): boolean {
  const context: Context = {
    doc: target.doc,
    mapping: target.mapping,
    dirty,
    points: [],
    changed: false,
    removed: false,
  }

  target.editor.update(
    () => {
      capturePoints(context)
      const root = $getRoot()
      context.mapping.link(containerId(target.root), root.getKey())
      $applyProps(target.root, root, context)
      $reconcileChildren(target.root, root, context)
      $restorePoints(context)
    },
    {
      tag: [...INBOUND_TAGS],
      skipTransforms: true,
      // REQUIRED. Lexical merges and splits adjacent TextNodes behind our back
      // and reports it via `normalizedNodes`; without a synchronous flush the
      // ContainerID ↔ NodeKey mapping drifts and the document corrupts.
      discrete: true,
    },
  )

  if (context.removed) {
    const nodeMap = target.editor.getEditorState()._nodeMap
    target.mapping.sweep({
      hasContainer: (id) => containerIsLive(target.doc, id),
      hasNode: (key) => nodeMap.has(key),
    })
  }

  return context.changed
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Apply an element container's props to an existing node, in place.
 *
 * `updateFromJSON` is Lexical's own in-place applier and the exact inverse of
 * the `exportJSON` the outbound direction writes, so this stays generic over
 * custom node types instead of poking private `__`-prefixed fields the way
 * `@lexical/yjs` does.
 *
 * @returns `false` when the node's type does NOT implement `updateFromJSON`
 * faithfully — the props did not take, so the caller must replace the node. That
 * is detected by re-reading `exportJSON`, never assumed, because a node whose
 * props silently fail to apply is a permanently-diverged document.
 */
function $applyProps(container: ElementContainer, node: LexicalNode, context: Context): boolean {
  const props = elementProps(container).toJSON() as Record<string, PropValue>
  if (!propsDiffer(props, node)) return true

  node.updateFromJSON(props as Record<string, never>)
  context.changed = true

  if (!propsDiffer(props, node)) return true
  // Fall through to replacement, but say why: a node type reaching this point
  // has an `exportJSON` its `updateFromJSON` cannot round-trip, which costs its
  // subtree's NodeKeys (and any decorator mount in it) on every remote change.
  console.error(
    `lexical-loro: '${node.getType()}'.updateFromJSON() does not apply every property its ` +
      'exportJSON() emits, so the node must be REPLACED on each remote change — which destroys ' +
      'its NodeKey, its DOM, and any mounted decorator sub-app. Implement updateFromJSON.',
  )
  return false
}

/**
 * Whether any prop the shared document holds differs from the node's own.
 *
 * Reads through `getLatest()`, which is load-bearing rather than defensive:
 * `updateFromJSON` writes through `getWritable()`, which CLONES the node, so the
 * reference the caller is holding is stale the moment the write lands. Comparing
 * against it would report the update as having failed and trigger a needless —
 * and mount-destroying — node replacement.
 */
function propsDiffer(props: Record<string, PropValue>, node: LexicalNode): boolean {
  const current = node.getLatest().exportJSON() as Record<string, unknown>
  for (const [key, value] of Object.entries(props)) {
    if (!jsonEqual(current[key], value)) return true
  }
  return false
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
// Children
// ---------------------------------------------------------------------------

/**
 * A Lexical element's children, grouped the way the schema stores them: one
 * entry per non-text child, one per MAXIMAL RUN of adjacent text nodes.
 *
 * The grouping must match `to-loro.ts`'s `describeChildren` exactly — a run is
 * the shared unit of identity, and disagreeing about where runs begin would make
 * the two directions match different containers to the same nodes.
 */
type Group = TextGroup | ElementGroup

interface TextGroup {
  readonly kind: 'text'
  readonly nodes: TextNode[]
  /** The run's registry key: its FIRST node's `NodeKey`. */
  readonly anchor: NodeKey
}

interface ElementGroup {
  readonly kind: 'element'
  readonly node: LexicalNode
  readonly key: NodeKey
}

function groupChildren(node: ElementNode): Group[] {
  const out: Group[] = []
  let run: TextNode[] = []
  const flush = (): void => {
    if (run.length === 0) return
    out.push({ kind: 'text', nodes: run, anchor: run[0]!.getKey() })
    run = []
  }
  for (const child of node.getChildren()) {
    if ($isTextNode(child)) run.push(child)
    else {
      flush()
      out.push({ kind: 'element', node: child, key: child.getKey() })
    }
  }
  flush()
  return out
}

/**
 * Reconcile a Lexical element's children against its container's child list.
 *
 * Matching is by IDENTITY through the registry: a container that already
 * addresses a node reuses that node wherever it has moved to, which is what
 * turns a remote reorder — one `pos` register write — into a Lexical reorder
 * rather than a rebuild. Text runs additionally fall back to ordinal matching
 * among the text
 * children (mirroring the outbound direction), so a run whose anchor Lexical
 * normalized away still finds its nodes instead of recreating them.
 */
function $reconcileChildren(
  container: ElementContainer,
  node: ElementNode,
  context: Context,
): void {
  const desired = liveChildren(container)
  const groups = groupChildren(node)
  const claimed = new Set<Group>()

  const byKey = new Map<NodeKey, Group>()
  for (const group of groups) {
    byKey.set(group.kind === 'text' ? group.anchor : group.key, group)
  }
  const textGroups = groups.filter((group): group is TextGroup => group.kind === 'text')
  let nextText = 0

  const matched: (Group | undefined)[] = desired.map((child) => {
    const key = context.mapping.nodeKey(containerId(child))
    const found = key === undefined ? undefined : byKey.get(key)
    if (found !== undefined && !claimed.has(found)) {
      // A container whose node changed KIND (text ⇄ element) cannot be reused.
      if (isTextContainer(child) === (found.kind === 'text')) {
        claimed.add(found)
        return found
      }
    }
    if (!isTextContainer(child)) return undefined
    while (nextText < textGroups.length && claimed.has(textGroups[nextText]!)) nextText++
    const ordinal = textGroups[nextText]
    if (ordinal === undefined) return undefined
    nextText++
    claimed.add(ordinal)
    return ordinal
  })

  // 1. Build (or update in place) the node list this element should hold.
  const ordered: LexicalNode[] = []
  for (let i = 0; i < desired.length; i++) {
    const child = desired[i]!
    const group = matched[i]
    if (isTextContainer(child)) {
      const existing = group !== undefined && group.kind === 'text' ? group.nodes : []
      const nodes = $reconcileTextRun(child, existing, context)
      const id = containerId(child)
      if (nodes.length === 0) context.mapping.unlinkContainer(id)
      else context.mapping.link(id, nodes[0]!.getKey())
      ordered.push(...nodes)
      continue
    }
    const existing = group !== undefined && group.kind === 'element' ? group.node : undefined
    ordered.push($reconcileElementChild(child, existing, context))
  }

  // 2. Remove whatever is no longer wanted. `preserveEmptyParent` is TRUE:
  //    Lexical's default removes a parent that this leaves empty, which would
  //    delete a block the shared document still holds.
  const keep = new Set(ordered.map((child) => child.getKey()))
  for (const group of groups) {
    const nodes = group.kind === 'text' ? group.nodes : [group.node]
    for (const child of nodes) {
      if (keep.has(child.getKey())) continue
      const id = context.mapping.containerId(child.getKey())
      if (id !== undefined) context.mapping.unlinkNode(child.getKey())
      child.remove(true)
      context.changed = true
      context.removed = true
    }
  }

  // 3. Place everything in order. Lexical's insert helpers MOVE an
  //    already-attached node without minting a new key, so a reorder here costs
  //    no identity — which is the whole point of the movable-list schema.
  let previous: LexicalNode | null = null
  for (const child of ordered) {
    const parent = child.getParent()
    const attached = parent !== null && parent.is(node)
    const actual = attached ? child.getPreviousSibling() : undefined
    const inPlace =
      attached && ((actual === null && previous === null) || (actual?.is(previous) ?? false))
    if (!inPlace) {
      if (previous === null) {
        const first = node.getFirstChild()
        if (first === null) node.append(child)
        else first.insertBefore(child, false)
      } else {
        previous.insertAfter(child, false)
      }
      context.changed = true
    }
    previous = child
  }
}

/**
 * Reconcile one element child: update it in place when it is the same node, or
 * build a fresh subtree when there is nothing reusable.
 */
function $reconcileElementChild(
  container: ElementContainer,
  existing: LexicalNode | undefined,
  context: Context,
): LexicalNode {
  const id = containerId(container)
  if (existing !== undefined && existing.getType() === elementType(container)) {
    // Not dirty ⇒ nothing under this container changed, so do not descend.
    if (context.dirty !== null && !context.dirty.has(id)) {
      context.mapping.link(id, existing.getKey())
      return existing
    }
    if ($applyProps(container, existing, context)) {
      context.mapping.link(id, existing.getKey())
      if ($isElementNode(existing)) $reconcileChildren(container, existing, context)
      return existing
    }
    // Props could not be applied in place; fall through and rebuild.
  }
  context.changed = true
  return $buildNode(container, context)
}

/**
 * Build a fresh Lexical subtree from a container the registry cannot resolve —
 * a block a peer just created.
 *
 * Nodes are constructed through `$parseSerializedNode`, the inverse of the
 * `exportJSON` the outbound direction wrote, so custom node types (including
 * `LLuiDecoratorNode`) round-trip through their own `importJSON` with no
 * special-casing here.
 */
function $buildNode(container: ElementContainer, context: Context): LexicalNode {
  const serialized = {
    ...(elementProps(container).toJSON() as Record<string, unknown>),
    type: elementType(container),
    version: 1,
  } as SerializedLexicalNode
  const node = $parseSerializedNode(serialized)
  context.mapping.link(containerId(container), node.getKey())

  if ($isElementNode(node)) {
    for (const child of liveChildren(container)) $appendChild(node, child, context)
  }
  return node
}

/**
 * An element's children, in the order the shared document renders them.
 *
 * The ordering is `sort by (pos, uuid)` over the child carriers — see
 * `order.ts`. This is the ONE place the inbound walk touches the ordering model
 * at all: every carrier is dereferenced to the container the registry addresses
 * it by (the `LoroText` for a run, the element map for an element), and from
 * there this module is exactly as it was under the list schema.
 *
 * ── PROJECTION MUST DEPEND ONLY ON REPLICATED STATE ────────────────────────
 *
 * `orderedChildren` consults no `isDeleted()`, and nothing here may add one.
 * Under the previous `LoroMovableList` schema an earlier version of this
 * function filtered "tombstones" out, reasoning that a shared rule keeps both
 * peers showing the same thing. It does not, and cannot: `isDeleted()` is
 * PEER-LOCAL bookkeeping, not replicated state. The peer that issued a delete
 * kept reporting `true` while every other peer reported `false`, for the same
 * ContainerID in the same list, so it rendered one block fewer than everybody
 * else — permanently, since no later batch ever mentioned the container again.
 *
 * The carrier schema removes the temptation rather than relying on the rule
 * being remembered: a deleted carrier's key is absent from `keys()` on every
 * peer, symmetrically, so the projection is a pure function of the document by
 * construction.
 */
function liveChildren(container: ElementContainer): ChildContainer[] {
  return orderedChildren(container).map((entry) => entry.container)
}

function $appendChild(parent: ElementNode, child: ChildContainer, context: Context): void {
  if (isTextContainer(child)) {
    const nodes = buildTextNodes(runsFromText(child))
    if (nodes.length === 0) return
    context.mapping.link(containerId(child), nodes[0]!.getKey())
    for (const node of nodes) parent.append(node)
    return
  }
  parent.append($buildNode(child, context))
}

// ---------------------------------------------------------------------------
// Text runs
// ---------------------------------------------------------------------------

function buildTextNodes(runs: readonly TextRun[]): TextNode[] {
  return runs.map((run) => {
    const node = $createTextNode(run.text)
    if (run.format !== 0) node.setFormat(run.format)
    return node
  })
}

/**
 * Reconcile one text run in place, reusing the existing `TextNode`s.
 *
 * The FIRST node is the run's registry anchor, so keeping it is what keeps the
 * container's address stable across the edit. Nodes are reused positionally and
 * only written when their text or format actually differs, which is what keeps a
 * caret in an unchanged part of the run untouched.
 *
 * An EMPTY container yields zero nodes rather than one empty `TextNode`: the
 * outbound direction EMPTIES a run's last `LoroText` instead of deleting it (so
 * a peer's concurrent insertion into that exact container survives), and an
 * empty run must project as no text at all.
 */
function $reconcileTextRun(
  text: import('loro-crdt').LoroText,
  existing: readonly TextNode[],
  context: Context,
): TextNode[] {
  const target = runsFromText(text)
  const current = normalizeRuns(
    existing.map((node) => ({ text: node.getTextContent(), format: node.getFormat() })),
  )
  if (runsEqual(current, target)) return [...existing]

  $transformPoints(current, target, existing, context)

  const out: TextNode[] = []
  for (let i = 0; i < target.length; i++) {
    const run = target[i]!
    const node = existing[i]
    if (node === undefined) {
      out.push(buildTextNodes([run])[0]!)
      continue
    }
    if (node.getTextContent() !== run.text) node.setTextContent(run.text)
    if (node.getFormat() !== run.format) node.setFormat(run.format)
    out.push(node)
  }
  for (let i = target.length; i < existing.length; i++) {
    const node = existing[i]!
    context.mapping.unlinkNode(node.getKey())
    node.remove(true)
    context.removed = true
  }
  context.changed = true

  $resolvePoints(target, out, context)
  return out
}

function runsEqual(a: readonly TextRun[], b: readonly TextRun[]): boolean {
  return (
    a.length === b.length &&
    a.every((run, i) => run.text === b[i]!.text && run.format === b[i]!.format)
  )
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Record where the caret sits, as a run-absolute offset.
 *
 * Only TEXT points are captured. An element point addresses a `NodeKey` this
 * module preserves, so it survives on its own; a text point is the one thing a
 * remote edit to the same run can invalidate.
 */
function capturePoints(context: Context): void {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return
  for (const point of [selection.anchor, selection.focus]) {
    if (point.type !== 'text') continue
    const node = point.getNode()
    if (!$isTextNode(node)) continue
    const run = runNodesFor(node)
    let offset = 0
    for (const sibling of run) {
      if (sibling.is(node)) break
      offset += sibling.getTextContentSize()
    }
    context.points.push({
      point,
      runKeys: run.map((n) => n.getKey()),
      offset: offset + point.offset,
      resolved: null,
    })
  }
}

/** The maximal run of adjacent text nodes containing `node`. */
function runNodesFor(node: TextNode): TextNode[] {
  const run: TextNode[] = [node]
  for (let prev = node.getPreviousSibling(); $isTextNode(prev); prev = prev.getPreviousSibling()) {
    run.unshift(prev)
  }
  for (let next = node.getNextSibling(); $isTextNode(next); next = next.getNextSibling()) {
    run.push(next)
  }
  return run
}

/**
 * Move a captured caret through the text change about to be applied.
 *
 * The change is described as ONE region (`diffTextWithCursor`, biased to the
 * caret so a repeated-character edit is attributed where the user actually is):
 * a caret at or before the region is unmoved, one after it shifts by
 * `insert.length - remove`, and one inside a deleted span clamps to the region's
 * start — which is where a user would expect to be left standing.
 */
function $transformPoints(
  current: readonly TextRun[],
  target: readonly TextRun[],
  existing: readonly TextNode[],
  context: Context,
): void {
  const affected = context.points.filter((captured) =>
    existing.some((node) => captured.runKeys.includes(node.getKey())),
  )
  if (affected.length === 0) return

  const before = runsText(current)
  const after = runsText(target)
  for (const captured of affected) {
    const diff = diffTextWithCursor(before, after, captured.offset)
    if (captured.offset <= diff.index) continue
    if (captured.offset <= diff.index + diff.remove) captured.offset = diff.index
    else captured.offset += diff.insert.length - diff.remove
  }
}

/** Locate each affected caret inside the rebuilt run. */
function $resolvePoints(
  target: readonly TextRun[],
  nodes: readonly TextNode[],
  context: Context,
): void {
  for (const captured of context.points) {
    if (!nodes.some((node) => captured.runKeys.includes(node.getKey()))) continue
    if (nodes.length === 0) continue
    let remaining = Math.max(0, Math.min(captured.offset, runsText(target).length))
    let resolved: { node: TextNode; offset: number } | null = null
    for (const node of nodes) {
      const size = node.getTextContentSize()
      if (remaining <= size) {
        resolved = { node, offset: remaining }
        break
      }
      remaining -= size
    }
    captured.resolved = resolved ?? {
      node: nodes[nodes.length - 1]!,
      offset: nodes[nodes.length - 1]!.getTextContentSize(),
    }
  }
}

/** Re-place every caret whose run this pass rebuilt. */
function $restorePoints(context: Context): void {
  for (const captured of context.points) {
    const resolved = captured.resolved
    if (resolved === null) continue
    captured.point.set(resolved.node.getKey(), resolved.offset, 'text')
  }
  // Writing a point mutates the live selection in place; nothing else is needed,
  // but re-setting it makes Lexical mark the selection dirty so the change is
  // reconciled to the DOM.
  const selection = $getSelection()
  if (selection !== null && context.points.some((captured) => captured.resolved !== null)) {
    $setSelection(selection.clone())
  }
}
