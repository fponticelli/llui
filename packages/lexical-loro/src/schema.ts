/**
 * The Loro container schema that mirrors a Lexical `EditorState`.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────
 *
 *   doc.getMap('root')                                 // ElementContainer
 *     'type'     -> string                             // node.getType()
 *     'props'    -> LoroMap<Record<string, PropValue>> // node props, LWW per key
 *     'children' -> LoroMap<uuid, ChildCarrier>        // UNORDERED; see below
 *
 * Every child is a CARRIER map, keyed in `children` by its own uuid:
 *
 *   ChildCarrier = LoroMap {
 *     'uuid' -> string                 // its own key, duplicated for reading
 *     'pos'  -> string                 // fractional index; see `order.ts`
 *     'kind' -> 'element' | 'text'
 *     // kind === 'element' — the carrier IS the child's ElementContainer:
 *     'type' -> string
 *     'props' -> LoroMap
 *     'children' -> LoroMap<uuid, ChildCarrier>
 *     // kind === 'text':
 *     'text' -> LoroText               // created ONCE, never recreated
 *   }
 *
 * Sibling order is NOT a list position. It is `sort by (pos, uuid)` — a pure
 * function of replicated state, and therefore commutative by construction.
 *
 * ── Why fractional indexing, not a LoroMovableList ─────────────────────────
 *
 * This schema previously held children in a `LoroMovableList`, whose `move` op
 * preserves container identity. That property is load-bearing here: ContainerID
 * is our stable address for a `NodeKey` (see `mapping.ts`), so a child that is
 * deleted and recreated instead of moved forces its whole subtree to be rebuilt
 * with fresh NodeKeys — which DISPOSES every mounted `LLuiDecoratorNode` sub-app
 * in it (`packages/lexical/src/decorator.ts` disposes on the 'destroyed'
 * mutation). Block drag-reorder is a real operation in this editor.
 *
 * `LoroMovableList` was abandoned because loro-crdt 1.13.7 — the LATEST release,
 * with no upgrade path — has TWO defects in it, both pinned by
 * `test/loro-upstream.test.ts`:
 *
 *  1. A WASM PANIC. Uncatchable from JavaScript, and it leaves the document in
 *     an unspecified state, so there is no recovery path to write.
 *  2. A SILENT CONVERGENCE FAILURE — two peers accept the same updates and
 *     render different documents, with nothing to detect it from.
 *
 * A plain `LoroList` plus uuid identity was evaluated and REJECTED: without a
 * move op, a reorder is delete+recreate, which silently LOSES a peer's
 * concurrent edit into the moved subtree. Convergent and unrepairable — strictly
 * worse than the defects it was meant to route around.
 *
 * Fractional indexing keeps the property that mattered. A same-parent move is
 * ONE last-writer-wins register write to `pos` (~87 bytes regardless of subtree
 * size): no container is deleted, none is created, and every `ContainerID` —
 * including every `LoroText` — is INVARIANT across reorder, text edits, and
 * parent moves. So a concurrent edit into a moved subtree survives, and
 * `mapping.ts` needs no notion of any of this.
 *
 * ── What this deliberately does NOT claim ──────────────────────────────────
 *
 * Three documented limits. Do not read the paragraph above as covering them:
 *
 *  - CROSS-PARENT moves are still delete+recreate, and DO lose a concurrent edit
 *    into the moved subtree. The "concurrent edit preserved" property is
 *    SAME-PARENT ONLY. (This is not a regression: `LoroMovableList#move` is also
 *    confined to a single list.)
 *  - DELETE BEATS MOVE. A delete concurrent with a move wins and the block
 *    vanishes, in both delivery orders. Chosen deliberately: `LoroMovableList`
 *    does the opposite — it RESURRECTS a deliberately deleted block — and pays
 *    for it with defect 1 above. A tombstone mitigation was tried and REFUTED BY
 *    TEST (the delete flag and `pos` are different map keys, so both survive and
 *    nothing is resurrected). Do not re-add tombstones.
 *  - TWO CONCURRENT SPLITS of the same text run converge on a child COUNT, not
 *    on sensible text: ordinal text matching mints a fresh tail container on each
 *    peer, so the merged document duplicates a fragment. Pre-existing — the
 *    `LoroMovableList` binding produced the same duplication for the same history
 *    — and out of scope for the ordering model. Verified against real Lexical;
 *    see `test/convergence-attack.test.ts` for the concurrent-text histories.
 *
 * ── Why one LoroText per RUN, not per TextNode ─────────────────────────────
 *
 * A RUN is a MAXIMAL GROUP OF ADJACENT `TextNode`s — not one TextNode. That
 * distinction is the schema's text unit and it is doing real work: Lexical
 * splits and merges adjacent TextNodes freely (normalization), and a node
 * boundary is a rendering detail, not user intent. Mirroring nodes 1:1 would
 * make every normalization a structural CRDT edit and would let two peers'
 * different-but-equivalent splits conflict.
 *
 * The most common "split" is not a structural change at all: bolding a middle
 * sub-range makes Lexical split one TextNode into THREE, but all three are
 * adjacent, so they coalesce back to ONE desired child. The carrier count and
 * the `LoroText` ContainerID are unchanged and the format lands as a mark inside
 * the existing text. Verified against real Lexical 0.48 by the D1 case in
 * `test/to-loro.test.ts` ('run identity under Lexical normalization').
 *
 * ── Index units ────────────────────────────────────────────────────────────
 *
 * loro-crdt's JavaScript binding addresses `LoroText` in UTF-16 code units —
 * the same unit as JavaScript string indices and therefore the same unit as
 * Lexical offsets. NO conversion is required at this seam. (`convertPos` exists
 * for unicode/utf8 interop; we never need it.) This is pinned by a test in
 * `test/schema.test.ts` because it is an assumption the whole binding rests on
 * and it is not stated in loro-crdt's type declarations.
 */

import { LoroMap, LoroText, getType } from 'loro-crdt'
import type { Container, ContainerID, LoroDoc } from 'loro-crdt'

import { comparePositions } from './order.js'

// ---------------------------------------------------------------------------
// Container keys
// ---------------------------------------------------------------------------

/** Root map name on the `LoroDoc`. Mirrors Lexical's `RootNode`. */
export const ROOT_CONTAINER = 'root'

/** Key on an element map holding the Lexical node type (`node.getType()`). */
export const KEY_TYPE = 'type'

/** Key on an element map holding the scalar-prop sub-map. */
export const KEY_PROPS = 'props'

/** Key on an element map holding the child-carrier map. */
export const KEY_CHILDREN = 'children'

/**
 * Key on a child carrier holding its own uuid.
 *
 * Duplicated from the `children` map key so a carrier read in isolation still
 * knows its identity, and so the ordering tiebreak needs no parent lookup.
 */
export const KEY_UUID = 'uuid'

/** Key on a child carrier holding its fractional index. See `order.ts`. */
export const KEY_POS = 'pos'

/**
 * Key on a child carrier discriminating an element from a text run.
 *
 * Explicit rather than inferred from which other keys are present: a remote
 * update can be applied partially, and a carrier whose `type` has not landed yet
 * must be SKIPPED by the projection, not mistaken for a text run.
 */
export const KEY_KIND = 'kind'

/** Key on a TEXT carrier holding its `LoroText`. */
export const KEY_TEXT = 'text'

/**
 * `type` value used for an `LLuiDecoratorNode`. Its identity lives in
 * `props.bridgeType`; its serialized payload in `props.data`.
 */
export const DECORATOR_TYPE = 'llui-decorator'

/** `props` key naming which LLui bridge renders a decorator. */
export const KEY_BRIDGE_TYPE = 'bridgeType'

/** `props` key holding a decorator's JSON-serialized payload. */
export const KEY_DATA = 'data'

// ---------------------------------------------------------------------------
// Value + container types
// ---------------------------------------------------------------------------

/**
 * A value storable in an element's `props` map: any JSON value.
 *
 * Most Lexical node props are scalars (`tag`, `format`, `indent`, …), but not
 * all — `LLuiDecoratorNode.exportJSON()` emits `data: unknown`, an arbitrary
 * JSON payload, and that payload is precisely what makes a decorator's mounted
 * LLui sub-app reproducible on a peer. Loro stores a JSON value in a map slot as
 * ONE last-writer-wins register, which is the same granularity a scalar gets, so
 * widening the type costs nothing structurally.
 *
 * The LWW granularity is per KEY, not per nested field: two peers editing
 * different fields of the same `data` object do not merge, the later write wins
 * whole. Decorator payloads are small, opaque-to-us blobs, so that is the right
 * trade; a decorator wanting field-level merging should model its state as its
 * own Loro container rather than as a prop.
 */
export type PropValue =
  | string
  | number
  | boolean
  | null
  | PropValue[]
  | { [key: string]: PropValue }

/** An element's prop map. Each key is independently last-writer-wins. */
export type PropsContainer = LoroMap<Record<string, PropValue>>

/**
 * The map mirroring one Lexical `ElementNode` (or a `DecoratorNode` /
 * `LineBreakNode`, which simply carry an empty `children` map).
 *
 * Every element except the ROOT is also a child carrier, so it additionally
 * holds `uuid`, `pos` and `kind`. The root is reached through `doc.getMap` and
 * has no siblings to be ordered among, so those keys are optional.
 */
export type ElementContainer = LoroMap<ElementShape>

/** An element map's key set. */
export interface ElementShape extends Record<string, unknown> {
  [KEY_TYPE]: string
  [KEY_PROPS]: PropsContainer
  [KEY_CHILDREN]: ChildrenContainer
}

/** What a child carrier wraps. */
export type ChildKind = 'element' | 'text'

/** A carrier holding one text run's `LoroText`. */
export type TextCarrier = LoroMap<TextCarrierShape>

/** A text carrier's key set. */
export interface TextCarrierShape extends Record<string, unknown> {
  [KEY_UUID]: string
  [KEY_POS]: string
  [KEY_KIND]: 'text'
  [KEY_TEXT]: LoroText
}

/**
 * An element's children, keyed by uuid. UNORDERED — the rendered sequence comes
 * from {@link orderedChildren}, never from iteration order.
 */
export type ChildrenContainer = LoroMap<Record<string, ChildCarrier>>

/**
 * The keys EVERY child carrier holds, whatever it wraps.
 *
 * Typed as its own shape rather than as `ElementContainer | TextCarrier` so that
 * the ordering keys can be written without narrowing: a union of two generic
 * `LoroMap` signatures is not callable, and the position write is the one
 * operation that is genuinely common to both kinds.
 */
export interface CarrierShape extends Record<string, unknown> {
  [KEY_UUID]: string
  [KEY_POS]: string
  [KEY_KIND]: ChildKind
}

/** A carrier sitting in a `children` map, seen through its common keys. */
export type ChildCarrier = LoroMap<CarrierShape>

/**
 * The container a child's IDENTITY is registered under in `mapping.ts`: the
 * `LoroText` for a text run, the element map itself for an element.
 *
 * Both are invariant across every reorder, which is what lets the registry stay
 * ignorant of the ordering model entirely.
 */
export type ChildContainer = ElementContainer | LoroText

/** One child of an element, as the ordering projection sees it. */
export interface ChildEntry {
  readonly uuid: string
  readonly pos: string
  readonly kind: ChildKind
  /** The carrier map. For an element child this IS its {@link ElementContainer}. */
  readonly carrier: ChildCarrier
  /** The container this child is addressed by. See {@link ChildContainer}. */
  readonly container: ChildContainer
}

// ---------------------------------------------------------------------------
// Text-style configuration
// ---------------------------------------------------------------------------

/** Loro's per-mark conflict-resolution rule. */
export type ExpandType = 'before' | 'after' | 'none' | 'both'

/**
 * The `expand` rule applied UNIFORMLY to every text format.
 *
 * Read `test/expand-semantics.test.ts` before changing this. `expand` is NOT
 * the mechanism that reproduces Lexical's boundary behaviour — a 51-test spike
 * proved no uniform table can, and that no per-format table can either (the
 * divergence set is identical for all 11 formats, because Lexical has no
 * per-format inclusivity: its caret is uniformly left-biased). The Lexical→Loro
 * direction replays RESULTING NODE STATE via explicit mark/unmark ops instead
 * (see `diffRunFormats` in `text.ts`), which makes the local result correct
 * regardless of `expand`.
 *
 * `expand` therefore governs exactly one thing: what happens to text a REMOTE
 * peer inserts CONCURRENTLY at a mark boundary. `'after'` is the closest fit to
 * Lexical's left-biased caret.
 */
export const TEXT_MARK_EXPAND: ExpandType = 'after'

// ---------------------------------------------------------------------------
// Construction + access
// ---------------------------------------------------------------------------

/** The Lexical node type of the root. Matches `RootNode.getType()`. */
export const ROOT_TYPE = 'root'

/**
 * Configure a `LoroDoc` for this schema and return its root element container,
 * creating the root's schema keys if they are missing.
 *
 * Every peer MUST call this. Two reasons, both load-bearing:
 *
 * 1. `configTextStyle` is LOCAL configuration, not replicated state. A peer that
 *    skips it resolves marks under different expand rules and diverges.
 * 2. The root's `props`/`children` are created with `ensureMergeable*`, which
 *    derives a DETERMINISTIC ContainerID from the parent and key. Two peers may
 *    each initialize an empty document before ever hearing from one another; a
 *    plain `setContainer` would mint two different child containers and the map
 *    slot's last-writer-wins would silently discard one peer's entire document.
 *    `ensureMergeable*` makes both peers land on the same container, so their
 *    edits merge. (Only the ROOT needs this — every other element is created
 *    whole by a single peer and inserted as one op.)
 */
export function initDoc(doc: LoroDoc, formats: readonly string[]): ElementContainer {
  doc.configTextStyle(
    Object.fromEntries(formats.map((format) => [format, { expand: TEXT_MARK_EXPAND }])),
  )
  const root = doc.getMap(ROOT_CONTAINER) as ElementContainer
  // Write only what is missing. `initDoc` runs on every binding construction —
  // and a shared `LoroDoc` may back more than one — so an unconditional `set`
  // would queue a redundant local op that the next `import`/`commit` flushes to
  // every peer as a spurious update.
  if (root.get(KEY_TYPE) !== ROOT_TYPE) root.set(KEY_TYPE, ROOT_TYPE)
  root.ensureMergeableMap(KEY_PROPS)
  root.ensureMergeableMap(KEY_CHILDREN)
  return root
}

/**
 * A fresh child identity.
 *
 * MUST be random. Two peers minting the same uuid would collide on one slot of
 * the `children` map, whose last-writer-wins would silently discard a whole
 * block — the same class of data loss `initDoc`'s `ensureMergeable*` exists to
 * prevent for the root.
 */
export function newUuid(): string {
  return crypto.randomUUID()
}

/**
 * Create an element child inside `children` and return its ATTACHED container.
 *
 * The carrier IS the element container: an element needs a `pos` anyway, so
 * wrapping it in a second map would cost an extra container and an extra
 * dereference for nothing. Only the attached handle has a stable `ContainerID`,
 * so always take identity from what this returns.
 */
export function createElementChild(
  children: ChildrenContainer,
  uuid: string,
  pos: string,
  type: string,
): ElementContainer {
  const element = children.setContainer(uuid, new LoroMap()) as ElementContainer
  element.set(KEY_UUID, uuid)
  element.set(KEY_POS, pos)
  element.set(KEY_KIND, 'element')
  element.set(KEY_TYPE, type)
  element.setContainer(KEY_PROPS, new LoroMap() as PropsContainer)
  element.setContainer(KEY_CHILDREN, new LoroMap() as ChildrenContainer)
  return element
}

/**
 * Create a text child inside `children` and return its ATTACHED `LoroText`.
 *
 * The `LoroText` is created once, inside its carrier, and never moved or
 * recreated — which is precisely what makes its `ContainerID` invariant across
 * every reorder, and therefore what lets a peer's concurrent insertion into it
 * survive a block move.
 */
export function createTextChild(children: ChildrenContainer, uuid: string, pos: string): LoroText {
  const carrier = children.setContainer(uuid, new LoroMap()) as TextCarrier
  carrier.set(KEY_UUID, uuid)
  carrier.set(KEY_POS, pos)
  carrier.set(KEY_KIND, 'text')
  return carrier.setContainer(KEY_TEXT, new LoroText())
}

/** Re-position a child — the whole cost of a same-parent move. */
export function setChildPosition(carrier: ChildCarrier, pos: string): void {
  carrier.set(KEY_POS, pos)
}

/** Remove a child from its parent, container and all. */
export function deleteChild(children: ChildrenContainer, uuid: string): void {
  children.delete(uuid)
}

/**
 * An element's children in RENDERED order: sorted by `(pos, uuid)`.
 *
 * Malformed carriers are SKIPPED rather than thrown on. That is not defensive
 * padding: a remote update can be applied while a carrier's keys are still
 * arriving, and a partially-materialized child must not crash a render — it will
 * appear on the next event, once its `pos` and `kind` have landed.
 *
 * Nothing here consults `isDeleted()`, and nothing may. Projection must depend
 * ONLY on replicated state; a deleted carrier is simply absent from `keys()` on
 * every peer, which is what makes this a pure function of the document.
 */
export function orderedChildren(element: ElementContainer): ChildEntry[] {
  const children = elementChildren(element)
  const out: ChildEntry[] = []
  for (const uuid of children.keys()) {
    // Read as `unknown` and narrow by `instanceof`: the map's declared value
    // type is a PROMISE about well-formed carriers, and this function's whole
    // job is to hold that promise against a document that may not keep it yet.
    const carrier: unknown = children.get(uuid)
    if (!(carrier instanceof LoroMap)) continue
    const pos = carrier.get(KEY_POS)
    const kind = carrier.get(KEY_KIND)
    if (typeof pos !== 'string') continue
    if (kind === 'text') {
      const text = carrier.get(KEY_TEXT)
      if (!(text instanceof LoroText)) continue
      out.push({ uuid, pos, kind, carrier: carrier as ChildCarrier, container: text })
    } else if (kind === 'element') {
      const container = carrier as ElementContainer
      if (typeof container.get(KEY_TYPE) !== 'string') continue
      out.push({ uuid, pos, kind, carrier: carrier as ChildCarrier, container })
    }
  }
  return out.sort((x, y) => comparePositions(x.pos, x.uuid, y.pos, y.uuid))
}

/** How many well-formed children an element has. */
export function childCount(element: ElementContainer): number {
  return orderedChildren(element).length
}

/** Read an element's Lexical node type. */
export function elementType(element: ElementContainer): string {
  const type = element.get(KEY_TYPE)
  if (typeof type !== 'string') {
    throw new Error(`lexical-loro: element ${element.id} has no '${KEY_TYPE}' string`)
  }
  return type
}

/** Read an element's scalar-prop map. */
export function elementProps(element: ElementContainer): PropsContainer {
  const props = element.get(KEY_PROPS)
  if (!(props instanceof LoroMap)) {
    throw new Error(`lexical-loro: element ${element.id} has no '${KEY_PROPS}' map`)
  }
  return props as PropsContainer
}

/** Read an element's child-carrier map. UNORDERED — see {@link orderedChildren}. */
export function elementChildren(element: ElementContainer): ChildrenContainer {
  const children = element.get(KEY_CHILDREN)
  if (!(children instanceof LoroMap)) {
    throw new Error(`lexical-loro: element ${element.id} has no '${KEY_CHILDREN}' map`)
  }
  return children as ChildrenContainer
}

/** Narrow a child slot to an element container. */
export function isElementContainer(child: unknown): child is ElementContainer {
  return child instanceof LoroMap
}

/** Narrow a child slot to a text run. */
export function isTextContainer(child: unknown): child is LoroText {
  return child instanceof LoroText
}

/** True when this element mirrors an `LLuiDecoratorNode`. */
export function isDecoratorElement(element: ElementContainer): boolean {
  return elementType(element) === DECORATOR_TYPE
}

/**
 * Whether a container still exists in the document.
 *
 * `getContainerById` keeps returning a usable handle for a DELETED container, so
 * `isDeleted()` is the real test. The kind narrowing is not defensive padding:
 * `Container` includes `LoroCounter`, `LoroList` and `LoroTree`, which this
 * schema never uses, and only its two kinds may enter the registry.
 *
 * This is a LOCAL liveness question — "is the registry entry stale?" — not a
 * projection question. See {@link orderedChildren}.
 */
export function containerIsLive(doc: LoroDoc, id: ContainerID): boolean {
  const container = doc.getContainerById(id)
  if (container instanceof LoroMap) return !container.isDeleted()
  if (container instanceof LoroText) return !container.isDeleted()
  return false
}

/**
 * The `ContainerID` of an attached container — the STABLE, cross-peer address
 * this binding maps to a per-session `NodeKey`. Throws on a detached container,
 * which has no replicated identity and must never enter the mapping.
 */
export function containerId(container: Container): ContainerID {
  const attached = container.getAttached()
  if (attached === undefined) {
    throw new Error(
      `lexical-loro: refusing to address a DETACHED ${getType(container)} container — ` +
        'insert it into its parent first and use the handle the insert returns',
    )
  }
  return attached.id
}
