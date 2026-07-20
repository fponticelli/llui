---
title: '@llui/lexical-loro'
description: 'Opt-in collaborative editing for the LLui ↔ Lexical editor over the Loro CRDT — bidirectional binding, container schema, and text formats as independent named marks.'
---

# @llui/lexical-loro

Opt-in collaborative editing over [Loro](https://loro.dev). `loroCollab` composes
a full bidirectional binding into one `register` you hand to `lexicalForeign`,
and satisfies `@llui/markdown-editor`'s `CollabBinding` structurally.

```bash
pnpm add @llui/lexical-loro @llui/lexical lexical loro-crdt
```

`@llui/lexical`, `lexical` and `loro-crdt` are peer dependencies.

## Usage

```ts
import { LoroDoc } from 'loro-crdt'
import { lexicalForeign } from '@llui/lexical'
import { loroCollab } from '@llui/lexical-loro'

const doc = new LoroDoc()

// There is no built-in transport, deliberately: `LoroDoc` already exposes the
// whole wire surface (`subscribeLocalUpdates` / `import` / `export`).
doc.subscribeLocalUpdates((bytes) => transport.send(bytes))
transport.onMessage((bytes) => doc.import(bytes))

const collab = loroCollab({
  doc,
  // Only peers that CREATE a document may seed it. A peer whose transport has
  // not finished its first sync sees an empty document and must not seed.
  shouldBootstrap: isCreator,
})

lexicalForeign({
  // Loro owns document convergence; Lexical's own boot-time seeding must not race it.
  seedMode: 'deferred',
  // Undo stays Lexical's LOCAL history — see the scope note below. Do NOT set false.
  history: true,
  register: collab.register,
})
```

With `@llui/markdown-editor`, which supplies the seed hook for you:

```ts
markdownEditor({
  defaultValue: '# Hello',
  collab: (hooks) => loroCollab({ doc, seed: hooks.seed, shouldBootstrap: isCreator }),
})
```

Call `collab.bootstrap(editor)` again after your transport's first sync — an
unsynced document looks empty, and seeding one races the content about to arrive.

## Scope (v1)

**Document sync only.** No presence, no remote cursors, and no CRDT-aware undo.
Text-node `style`, `mode` and `detail` are not represented; the run model is
`{ text, format }`. Presence over Loro's `EphemeralStore` is additive, later work.

**Undo is Lexical's local history, and it is not collaboration-safe.** A host
**must not** disable it for this binding — that leaves the user with no undo at
all. But note the sharper limit: `@lexical/history` has no notion of a
collaboration tag, so an inbound remote edit is recorded as though the local user
made it. **Undoing after a remote edit re-applies a snapshot predating that edit
and removes the remote block for every peer.** The document stays convergent and
well-formed, but the outcome is not what the user asked for. Tagging cannot fix
it — the defect is snapshot-vs-operation — so the fix is a CRDT-aware
`UndoManager`, at which point `LoroCollab.externalUndo` becomes its registration
hook and hosts need no change.

## How sibling order works: fractional indexing

An element's children are **not** stored in a list. Each child — element **or**
text run — is a _carrier_ `LoroMap` holding `{ uuid, pos, kind, … }`, filed in
its parent's `children` map under its own random `uuid`. A text carrier holds
its `LoroText` under a `text` key, created **once** and never recreated.

The rendered order is a pure projection of replicated state:

```
sort by (pos, uuid)
```

`pos` is a fractional index — a base-62 string key with one always available
strictly between any two distinct keys. So a **same-parent move is one
last-writer-wins register write to `pos`**: nothing is deleted, nothing is
recreated, and nothing inside the moved subtree is touched.

That buys three things:

- **`ContainerID`s are invariant across a move.** Container identity is what the
  binding maps to Lexical `NodeKey`s, so a remote reorder does not invalidate a
  local caret and does not remount an `LLuiDecoratorNode` sub-app.
- **A move costs O(1) on the wire** — under 400 bytes whether the moved block has
  two children or two hundred.
- **A concurrent edit _into_ a moved block survives**, because the container it
  was written to still exists.

Ordering is derived by sorting replicated fields, so peers holding the same state
cannot disagree about order — convergence is true by construction rather than by
conflict resolution.

### Why not `LoroMovableList`

That was the original design, and its `move` is exactly what the schema wants. It
was abandoned because `loro-crdt` 1.13.7 (the latest release) has two defects in
its handling of concurrent move/delete histories: an **uncatchable WASM panic**,
and a **silent convergence failure** where peers that have exchanged full
snapshots both ways still render different orders. Neither is workaroundable at
this layer. Both are pinned as `it.fails` in `test/loro-upstream.test.ts`, which
exists to justify the schema and to turn red if a future release fixes them.

### Accepted tradeoffs — stated honestly

These are real costs, deliberately chosen, each demonstrated in
`test/constraints.test.ts`:

- **The concurrent-edit guarantee is same-parent only.** A **cross-parent** move
  is still delete + recreate, and it **does** lose a concurrent edit into the
  moved subtree. (Not a regression: `LoroMovableList#move` is also confined to a
  single list.)
- **Delete beats move.** A delete concurrent with a move of the same block wins;
  the block vanishes, convergently, in both delivery orders. A tombstone
  mitigation was tried and **refuted by test** — the delete flag and `pos` are
  separate map keys, so both survive and nothing is rescued. Do not re-add
  tombstones.
- **`pos` keys are never rebalanced, and must not be.** Rewriting keys to spread
  them out is unsafe: a peer that inserted concurrently computed its key against
  the _old_ keys, so after the merge its block lands somewhere unrelated to what
  the user pointed at — convergent, and silently wrong about intent. It is also
  unnecessary: growth is linear and bounded (2000 adversarial same-spot inserts
  reach a 401-character key, and a move carries exactly one such key).
- **Two concurrent splits of the same text run garble the text.** Ordinal text
  matching mints a fresh tail container on each peer, so the merge duplicates a
  fragment. This is **pre-existing** — the `LoroMovableList` binding produced the
  same result on the same history — and is a property of text matching, not of
  the ordering model. It is not fixed here.

## Why formats are independent marks, not one bitmask

Lexical's `TextNode.__format` is a 32-bit bitmask (`IS_BOLD = 1`,
`IS_ITALIC = 1 << 1`, …). Storing that mask as a single CRDT value makes two
peers concurrently toggling **bold** and **italic** a last-writer-wins conflict
that silently drops one toggle. Each format therefore becomes its own named Loro
mark, which merges to the union of the two toggles.

## Boundary formats and `expand`

Lexical's caret is **left-biased** at every text-run boundary — a collapsed
caret at offset 0 of a text node normalizes onto the end of the previous text
node, then inherits that node's format. Loro's `expand: 'after'` reproduces that
for every boundary except typing at the very start of a paragraph whose first
run is formatted. And a format toggled at a collapsed caret has no expression as
an expand rule at all. The binding therefore treats Lexical as authoritative and
replays the resulting runs as explicit marks/unmarks; `expand` only governs what
happens to text a **remote** peer concurrently inserts at a mark boundary.

`test/expand-semantics.test.ts` pins all of this against real headless Lexical
and is the specification for the text-format half — read it before touching
`text.ts`.

## Echo suppression

Three independent layers are **all** required; `binding.ts` documents where each
lives and what breaks without it. One has no code to enforce it: this binding
never emits `PROGRAMMATIC_TAG`, because `@llui/lexical`'s `foreign.ts` reads that
tag as "the host pushed content — cancel pending outbound work", which would make
the host's persistence go dark whenever a peer types.

## Triaging a suspected convergence bug

The rule, recorded in the property tests: exchange full snapshots between peers
and compare `doc.toJSON()`. If the **documents** differ, the problem is below
this binding and not fixable here. Only if the documents agree while the
**editors** differ is it ours.

The two `loro-crdt` defects that rule out `LoroMovableList` (see above) are
pinned as `it.fails` in `test/loro-upstream.test.ts`. Neither is reachable from
the shipping schema — no `LoroMovableList` remains in `src/` — so they are kept
as the recorded rationale for the ordering model, not as live limitations.

<!-- auto-api:start -->

## Functions

### `adoptLoroDocument()`

Reconcile the ENTIRE shared document into the editor, with no dirty gate.
Used at boot by a peer adopting a document it has no event history for (see
`seed.ts`), and as the fallback whenever an event's container ancestry cannot
be resolved. Full-fidelity and identity-preserving: adopting a document the
editor already matches writes nothing and churns no NodeKeys.

```typescript
function adoptLoroDocument(target: InboundTarget): boolean
```

### `allocate()`

`count` strictly increasing keys inside the open interval `(before, after)`.
With `count === 1` the jitter is deliberately ignored (constraint 2). With
`count > 1` the whole batch hangs off ONE anchor carrying the jitter digit, so
two peers' concurrent batches occupy disjoint sub-intervals and cannot
interleave (constraint 1).
The anchor is a strict extension of a key already strictly below `after`, and
every subsequent key extends the anchor further, so the whole batch stays
inside the interval and in order.

```typescript
function allocate(
  before: string | null,
  after: string | null,
  count: number,
  jitter: string | null,
): string[]
```

### `allocateAt()`

`count` keys placing new children at rendered index `index` among siblings
whose positions are `positions` (ASCENDING — the order the projection
renders).
This is the only allocation entry point callers should use, because it is the
only one that can see, and therefore honour, constraint 4. When the left
neighbour's position EQUALS the right neighbour's — reachable whenever two
peers insert at the same slot concurrently — there is no key strictly between
them. Rather than emit one that breaks the sort invariant, the right bound is
widened to the first position STRICTLY greater than the left neighbour's, so
the new children land after the whole equal-position group.
That is a real, if narrow, loss of fidelity: the block lands one slot later
than the user pointed at. It is chosen over the alternatives deliberately —
repositioning the neighbour would be a localized rebalance (constraint 3), and
emitting an out-of-interval key would corrupt the ordering silently.

```typescript
function allocateAt(
  positions: readonly string[],
  index: number,
  count: number,
  jitter: string | null,
): string[]
```

### `applyLoroToLexical()`

Apply one Loro event batch to the editor.
@returns whether anything was applied. `false` means the batch was an echo of
our own write, or described no change the editor could see.

```typescript
function applyLoroToLexical(target: InboundTarget, batch: LoroEventBatch): boolean
```

### `applyMarkOps()`

Apply {@link MarkOp}s to a `LoroText`. The caller owns the surrounding
transaction (`doc.commit`), so a whole Lexical update lands as one Loro
change and therefore as one remote event batch.

```typescript
function applyMarkOps(text: LoroText, ops: readonly MarkOp[]): void
```

### `applyTextDiff()`

Apply a {@link TextDiff} to a `LoroText`. A no-op diff writes nothing, so a
Lexical update that changed only formatting produces no text ops (and so no
spurious remote text event).

```typescript
function applyTextDiff(text: LoroText, diff: TextDiff): void
```

### `between()`

A key strictly between `a` and `b`, where `null` means unbounded.
REQUIRES `a < b`. It does not check, and on equal or inverted bounds it
returns a key OUTSIDE the interval rather than failing — see constraint 4.
Prefer {@link allocateAt}, which cannot be called with a degenerate interval.

```typescript
function between(a: string | null, b: string | null): string
```

### `bitmaskFromAttributes()`

Read a Loro delta's attribute bag as a Lexical bitmask.
Only `true` counts as set: Loro represents an unmark as an explicit `null`
attribute in the delta, which must read as OFF, not as "present".

```typescript
function bitmaskFromAttributes(attributes: Readonly<Record<string, unknown>> | undefined): number
```

### `bitmaskFromFormats()`

Recompose named marks into a Lexical bitmask.

```typescript
function bitmaskFromFormats(formats: Iterable<LoroTextFormat>): number
```

### `bootstrapDocument()`

Bring the editor and the shared document into agreement at boot.
Idempotent: calling it again on a populated document adopts (writing nothing
and churning no NodeKeys), so a binding may safely call it on every sync
event without tracking whether it already ran.

```typescript
function bootstrapDocument(target: BootstrapTarget): BootstrapOutcome
```

### `childCount()`

How many well-formed children an element has.

```typescript
function childCount(element: ElementContainer): number
```

### `comparePositions()`

The rendered order of two children: by `pos`, then by `uuid`.
The uuid tiebreak is what makes this a TOTAL order even when two peers mint
the same `pos`, which is exactly what keeps every peer rendering the same
sequence. It resolves rendering only — it does not make the interval between
two equal positions usable; see constraint 4.

```typescript
function comparePositions(posA: string, uuidA: string, posB: string, uuidB: string): number
```

### `containerId()`

The `ContainerID` of an attached container — the STABLE, cross-peer address
this binding maps to a per-session `NodeKey`. Throws on a detached container,
which has no replicated identity and must never enter the mapping.

```typescript
function containerId(container: Container): ContainerID
```

### `containerIsLive()`

Whether a container still exists in the document.
`getContainerById` keeps returning a usable handle for a DELETED container, so
`isDeleted()` is the real test. The kind narrowing is not defensive padding:
`Container` includes `LoroCounter`, `LoroList` and `LoroTree`, which this
schema never uses, and only its two kinds may enter the registry.
This is a LOCAL liveness question — "is the registry entry stale?" — not a
projection question. See {@link orderedChildren}.

```typescript
function containerIsLive(doc: LoroDoc, id: ContainerID): boolean
```

### `createElementChild()`

Create an element child inside `children` and return its ATTACHED container.
The carrier IS the element container: an element needs a `pos` anyway, so
wrapping it in a second map would cost an extra container and an extra
dereference for nothing. Only the attached handle has a stable `ContainerID`,
so always take identity from what this returns.

```typescript
function createElementChild(
  children: ChildrenContainer,
  uuid: string,
  pos: string,
  type: string,
): ElementContainer
```

### `createTextChild()`

Create a text child inside `children` and return its ATTACHED `LoroText`.
The `LoroText` is created once, inside its carrier, and never moved or
recreated — which is precisely what makes its `ContainerID` invariant across
every reorder, and therefore what lets a peer's concurrent insertion into it
survive a block move.

```typescript
function createTextChild(children: ChildrenContainer, uuid: string, pos: string): LoroText
```

### `deleteChild()`

Remove a child from its parent, container and all.

```typescript
function deleteChild(children: ChildrenContainer, uuid: string): void
```

### `diffRunFormats()`

Diff two run lists into the minimal explicit `mark`/`unmark` ops that turn
`current` into `target`.
`current` is what Loro holds after the text edit landed (so `expand` has
already had its say); `target` is the runs Lexical actually produced. Both
MUST describe the same character count — call this only after the text
content has been reconciled.
Each format is diffed INDEPENDENTLY (that is the whole point of decomposing
the bitmask) and differing characters are coalesced into maximal ranges, so a
whole-paragraph bolding is one op, not one per character.

```typescript
function diffRunFormats(current: readonly TextRun[], target: readonly TextRun[]): MarkOp[]
```

### `diffText()`

Cursor-free variant: the change is placed as far LEFT as possible.
Equivalent to lib0's `simpleDiffString`. Use it only where no caret is known
(a programmatic document change); prefer {@link diffTextWithCursor} on any
user-typing path, where the leftmost placement is exactly the wrong guess.

```typescript
function diffText(a: string, b: string): TextDiff
```

### `diffTextWithCursor()`

Diff `a` → `b`, biased to place the change at `cursor`.
A plain "common prefix / common suffix" diff is ambiguous whenever the edit
sits next to repeated characters: typing `o` in `foo` could be described as an
insert at index 1, 2 or 3, and the plain diff always picks the leftmost. Every
peer then sees the character inserted at the wrong place, which drags remote
carets and (through Loro's `expand`) can even attach the wrong formatting.
Biasing the prefix scan to stop AT the cursor resolves the ambiguity in favour
of where the user actually typed. `@lexical/yjs` uses `simpleDiffWithCursor`
for exactly this reason; this is that algorithm (lib0's
`simpleDiffStringWithCursor`), including its surrogate-pair rollbacks, ported
so the package carries no lib0 dependency.
Surrogate handling: the scans never stop between the halves of a surrogate
pair, so an astral character is always inserted or deleted whole.
@param cursor UTF-16 offset of the caret in `b` (the new string).

```typescript
function diffTextWithCursor(a: string, b: string, cursor: number): TextDiff
```

### `elementChildren()`

Read an element's child-carrier map. UNORDERED — see {@link orderedChildren}.

```typescript
function elementChildren(element: ElementContainer): ChildrenContainer
```

### `elementProps()`

Read an element's scalar-prop map.

```typescript
function elementProps(element: ElementContainer): PropsContainer
```

### `elementType()`

Read an element's Lexical node type.

```typescript
function elementType(element: ElementContainer): string
```

### `formatBit()`

The bit value of a named format.

```typescript
function formatBit(format: LoroTextFormat): number
```

### `formatsFromBitmask()`

Decompose a Lexical bitmask into the named marks it sets, in bit order.

```typescript
function formatsFromBitmask(bitmask: number): LoroTextFormat[]
```

### `initDoc()`

Configure a `LoroDoc` for this schema and return its root element container,
creating the root's schema keys if they are missing.
Every peer MUST call this. Two reasons, both load-bearing:

1. `configTextStyle` is LOCAL configuration, not replicated state. A peer that
   skips it resolves marks under different expand rules and diverges.
2. The root's `props`/`children` are created with `ensureMergeable*`, which
   derives a DETERMINISTIC ContainerID from the parent and key. Two peers may
   each initialize an empty document before ever hearing from one another; a
   plain `setContainer` would mint two different child containers and the map
   slot's last-writer-wins would silently discard one peer's entire document.
   `ensureMergeable*` makes both peers land on the same container, so their
   edits merge. (Only the ROOT needs this — every other element is created
   whole by a single peer and inserted as one op.)

```typescript
function initDoc(doc: LoroDoc, formats: readonly string[]): ElementContainer
```

### `isDecoratorElement()`

True when this element mirrors an `LLuiDecoratorNode`.

```typescript
function isDecoratorElement(element: ElementContainer): boolean
```

### `isElementContainer()`

Narrow a child slot to an element container.

```typescript
function isElementContainer(child: unknown): child is ElementContainer
```

### `isSharedDocumentEmpty()`

Whether the shared document holds any content at all.

```typescript
function isSharedDocumentEmpty(root: ElementContainer): boolean
```

### `isTextContainer()`

Narrow a child slot to a text run.

```typescript
function isTextContainer(child: unknown): child is LoroText
```

### `jitterFor()`

A stable jitter digit for a peer.
Takes Loro's own `peerId`, so peers need no coordination to pick distinct
digits. Collisions across the {@link JITTER_DIGITS} alphabet only degrade to
the un-jittered behaviour for the colliding pair; they are not a correctness
problem.

```typescript
function jitterFor(peerId: bigint): string
```

### `longestIncreasingSubsequence()`

The indices of a longest strictly-increasing subsequence of `values`.
Patience sorting with a predecessor chain: O(n log n). Exported because it is
the part of the reorder planner worth testing in isolation — the number of
`pos` writes a drag-reorder costs is exactly `matched.length - lis.length`.

```typescript
function longestIncreasingSubsequence(values: readonly number[]): number[]
```

### `loroCollab()`

Build a collaborative-editing binding over a Loro document.
The document is configured for this package's schema (`initDoc`) immediately,
not at `register` time, so a transport may be attached to `collab.doc` before
any editor exists.

```typescript
function loroCollab(config: LoroCollabConfig = {}): LoroCollab
```

### `newUuid()`

A fresh child identity.
MUST be random. Two peers minting the same uuid would collide on one slot of
the `children` map, whose last-writer-wins would silently discard a whole
block — the same class of data loss `initDoc`'s `ensureMergeable*` exists to
prevent for the root.

```typescript
function newUuid(): string
```

### `normalizeRuns()`

Coalesce adjacent equal-format runs and drop empty ones, so two run lists
describing the same content compare structurally equal.
Necessary because Lexical's node boundaries are a rendering detail: `ab`+`c`
and `abc` at the same format are the same document.

```typescript
function normalizeRuns(runs: readonly TextRun[]): TextRun[]
```

### `orderedChildren()`

An element's children in RENDERED order: sorted by `(pos, uuid)`.
Malformed carriers are SKIPPED rather than thrown on. That is not defensive
padding: a remote update can be applied while a carrier's keys are still
arriving, and a partially-materialized child must not crash a render — it will
appear on the next event, once its `pos` and `kind` have landed.
Nothing here consults `isDeleted()`, and nothing may. Projection must depend
ONLY on replicated state; a deleted carrier is simply absent from `keys()` on
every peer, which is what makes this a pure function of the document.

```typescript
function orderedChildren(element: ElementContainer): ChildEntry[]
```

### `projectTarget()`

Project one Lexical element (or element-mirrored leaf) to a {@link TargetElement}.
MUST be called inside a Lexical read (`editorState.read(() => …)`), because it
reads node content. Uses only `lexical` (a peer dependency) — never
`@lexical/markdown`. See {@link targetFromEditorState} for the common wrapper.

```typescript
function projectTarget(node: LexicalNode): TargetElement
```

### `reconcileTargetIntoLoro()`

Reconcile a parsed target tree into an existing Loro document, preserving the
`ContainerID`s of unchanged and text-edited blocks, and commit under `origin`.
A SIBLING to `syncLexicalToLoro` — it writes Loro directly rather than mirroring
a Lexical update, matches by CONTENT rather than by `NodeKey`, and does NOT
consult the `ContainerNodeMap` (which self-heals on the inbound bounce).
@param doc the shared document.
@param root its root element container, as returned by `initDoc`.
@param target the desired tree, from {@link targetFromEditorState} /
{@link projectTarget} (the caller owns the markdown parse).
@param origin the commit origin. Defaults to {@link AGENT_WRITE_ORIGIN}; keep
it on the inbound target's applied-local-origins list, or a live
editor bound to the same doc will not see the change.
@returns the number of Loro write ops emitted. `0` means the target already
matched the document — nothing committed, no peer sees an event.

```typescript
function reconcileTargetIntoLoro(
  doc: LoroDoc,
  root: ElementContainer,
  target: TargetElement,
  origin: string = AGENT_WRITE_ORIGIN,
): number
```

### `registerLoroUndo()`

Register Loro-backed undo/redo on an editor.
Hand this to `lexicalForeign({ externalUndo })` — which forces the built-in
`@lexical/history` stack off, so the two can never both be live. The returned
disposer unregisters the commands and frees the manager.
The manager is constructed HERE rather than at `loroCollab()` time on purpose:
`lexicalForeign` calls `register` (which bootstraps the document) before
`externalUndo`, so the boot-time seed is already committed and is NOT on the
undo stack. A user's first undo can therefore never empty a freshly seeded
document.

```typescript
function registerLoroUndo(options: LoroUndoOptions, editor: LexicalEditor): () => void
```

### `runsFromDelta()`

Project a `LoroText`'s delta into normalized Lexical-shaped runs.

```typescript
function runsFromDelta(delta: readonly TextDeltaItem[]): TextRun[]
```

### `runsFromText()`

Project a live `LoroText` into normalized Lexical-shaped runs.

```typescript
function runsFromText(text: LoroText): TextRun[]
```

### `runsText()`

Concatenated text of a run list.

```typescript
function runsText(runs: readonly TextRun[]): string
```

### `seedLoroFromLexical()`

Fill the Loro document from an editor state with no previous state to diff
against — the bootstrapping peer's initial seed.
Structurally a full-fidelity diff, so it is also idempotent: seeding a
document that already matches emits nothing and returns `0`.

```typescript
function seedLoroFromLexical(target: OutboundTarget, editorState: EditorState): number
```

### `setChildPosition()`

Re-position a child — the whole cost of a same-parent move.

```typescript
function setChildPosition(carrier: ChildCarrier, pos: string): void
```

### `syncLexicalToLoro()`

Mirror one Lexical update into the Loro document and commit it.
@returns the number of Loro write operations emitted. `0` means the update
was a genuine no-op for the shared document — nothing was committed, so no
peer sees an event. Tests assert on this to catch pruning regressions.

```typescript
function syncLexicalToLoro(target: OutboundTarget, update: OutboundUpdate): number
```

### `targetFromEditorState()`

Project the root of an `EditorState` to a {@link TargetElement}, doing the read
for you.
The caller owns the markdown → editor-state parse (its own headless editor and
`@lexical/markdown` transformer set); this projects the parsed tree into the
plain, serializable shape {@link reconcileTargetIntoLoro} consumes. Uses only
`lexical`.

```typescript
function targetFromEditorState(state: EditorState): TargetElement
```

## Types

### `BootstrapOutcome`

What {@link bootstrapDocument} did.

```typescript
export type BootstrapOutcome =
  /** The shared document was empty and this peer filled it from `seed`. */
  | 'seeded'
  /** The shared document had content; the editor now mirrors it. */
  | 'adopted'
  /** Empty document, but this peer is not allowed to bootstrap it. */
  | 'waiting'
```

### `ChildCarrier`

A carrier sitting in a `children` map, seen through its common keys.

```typescript
export type ChildCarrier = LoroMap<CarrierShape>
```

### `ChildContainer`

The container a child's IDENTITY is registered under in `mapping.ts`: the
`LoroText` for a text run, the element map itself for an element.
Both are invariant across every reorder, which is what lets the registry stay
ignorant of the ordering model entirely.

```typescript
export type ChildContainer = ElementContainer | LoroText
```

### `ChildKind`

What a child carrier wraps.

```typescript
export type ChildKind = 'element' | 'text'
```

### `ChildrenContainer`

An element's children, keyed by uuid. UNORDERED — the rendered sequence comes
from {@link orderedChildren}, never from iteration order.

```typescript
export type ChildrenContainer = LoroMap<Record<string, ChildCarrier>>
```

### `ElementContainer`

The map mirroring one Lexical `ElementNode` (or a `DecoratorNode` /
`LineBreakNode`, which simply carry an empty `children` map).
Every element except the ROOT is also a child carrier, so it additionally
holds `uuid`, `pos` and `kind`. The root is reached through `doc.getMap` and
has no siblings to be ordered among, so those keys are optional.

```typescript
export type ElementContainer = LoroMap<ElementShape>
```

### `ExpandType`

Loro's per-mark conflict-resolution rule.

```typescript
export type ExpandType = 'before' | 'after' | 'none' | 'both'
```

### `LoroTextFormat`

```typescript
export type LoroTextFormat = (typeof LORO_TEXT_FORMATS)[number]
```

### `OutboundUpdate`

The slice of `UpdateListenerPayload` this direction consumes. Declared as a
`Pick` so an update listener can pass its payload straight through.
Register it with a BLOCK body, never an expression body:

```ts
editor.registerUpdateListener((payload) => {
  syncLexicalToLoro(target, payload)
})
```

Lexical 0.48 stores whatever an update listener RETURNS and calls it as a
cleanup before the next invocation (`triggerListeners` in `LexicalUpdates`),
so the concise `(payload) => syncLexicalToLoro(target, payload)` hands it this
function's op count and the second update dies with
"unregister is not a function".

```typescript
export type OutboundUpdate = Pick<
  UpdateListenerPayload,
  'prevEditorState' | 'editorState' | 'dirtyElements' | 'dirtyLeaves' | 'normalizedNodes' | 'tags'
>
```

### `PropsContainer`

An element's prop map. Each key is independently last-writer-wins.

```typescript
export type PropsContainer = LoroMap<Record<string, PropValue>>
```

### `PropValue`

A value storable in an element's `props` map: any JSON value.
Most Lexical node props are scalars (`tag`, `format`, `indent`, …), but not
all — `LLuiDecoratorNode.exportJSON()` emits `data: unknown`, an arbitrary
JSON payload, and that payload is precisely what makes a decorator's mounted
LLui sub-app reproducible on a peer. Loro stores a JSON value in a map slot as
ONE last-writer-wins register, which is the same granularity a scalar gets, so
widening the type costs nothing structurally.
The LWW granularity is per KEY, not per nested field: two peers editing
different fields of the same `data` object do not merge, the later write wins
whole. Decorator payloads are small, opaque-to-us blobs, so that is the right
trade; a decorator wanting field-level merging should model its state as its
own Loro container rather than as a prop.

```typescript
export type PropValue =
  | string
  | number
  | boolean
  | null
  | PropValue[]
  | { [key: string]: PropValue }
```

### `TargetChild`

One child of a target element: a text run or a nested element.

```typescript
export type TargetChild = TargetText | TargetElement
```

### `TextCarrier`

A carrier holding one text run's `LoroText`.

```typescript
export type TextCarrier = LoroMap<TextCarrierShape>
```

## Interfaces

### `BootstrapTarget`

```typescript
export interface BootstrapTarget {
  readonly doc: LoroDoc
  /** The root element container, as returned by `initDoc`. */
  readonly root: ElementContainer
  readonly mapping: ContainerNodeMap
  readonly editor: LexicalEditor
  /**
   * Fill an EMPTY editor with this peer's default content. Runs inside a Lexical
   * update, at most once, and only when the shared document is empty.
   */
  readonly seed?: ((editor: LexicalEditor) => void) | undefined
  /**
   * Whether this peer may bootstrap an empty shared document. Default `true`.
   * Set `false` on peers that join rather than create — with a real transport,
   * "empty" before the first sync is indistinguishable from "genuinely empty",
   * and a joining peer that seeds races the document it was about to receive.
   */
  readonly shouldBootstrap?: boolean | undefined
}
```

### `CarrierShape`

The keys EVERY child carrier holds, whatever it wraps.
Typed as its own shape rather than as `ElementContainer | TextCarrier` so that
the ordering keys can be written without narrowing: a union of two generic
`LoroMap` signatures is not callable, and the position write is the one
operation that is genuinely common to both kinds.

```typescript
export interface CarrierShape extends Record<string, unknown> {
  [KEY_UUID]: string
  [KEY_POS]: string
  [KEY_KIND]: ChildKind
}
```

### `ChildEntry`

One child of an element, as the ordering projection sees it.

```typescript
export interface ChildEntry {
  readonly uuid: string
  readonly pos: string
  readonly kind: ChildKind
  /** The carrier map. For an element child this IS its {@link ElementContainer}. */
  readonly carrier: ChildCarrier
  /** The container this child is addressed by. See {@link ChildContainer}. */
  readonly container: ChildContainer
}
```

### `ElementShape`

An element map's key set.

```typescript
export interface ElementShape extends Record<string, unknown> {
  [KEY_TYPE]: string
  [KEY_PROPS]: PropsContainer
  [KEY_CHILDREN]: ChildrenContainer
}
```

### `InboundTarget`

The Lexical side of the binding, plus the shared document it mirrors.

```typescript
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
   * outbound writes coming back round. But not every local batch is an echo:
   *
   *  - the CRDT-aware undo manager (`undo.ts`) produces LOCAL batches from
   *    `undo()`/`redo()` (`UNDO_ORIGINS`), and
   *  - the agent-write reconciler (`agent-write.ts`) writes the document directly
   *    under {@link import('./agent-write.js').AGENT_WRITE_ORIGIN},
   *
   * neither of which came FROM the editor, so both MUST be applied to bounce into
   * it (preserving `NodeKey`s and decorator mounts). `binding.ts` passes those
   * origins here. A local batch whose origin is on this list is applied; every
   * other local batch is still dropped as an echo.
   */
  readonly localOrigins?: readonly string[]
}
```

### `LivenessProbe`

Liveness probes used by {@link ContainerNodeMap.sweep}.

```typescript
export interface LivenessProbe {
  /** True when the container still exists in the Loro document. */
  readonly hasContainer: (id: ContainerID) => boolean
  /** True when the node still exists in the Lexical editor state. */
  readonly hasNode: (key: NodeKey) => boolean
}
```

### `LoroCollab`

Live handle returned by {@link loroCollab}.

```typescript
export interface LoroCollab {
  /**
   * Wire the binding onto an editor; pass as `lexicalForeign({ register })`.
   * Returns a disposer that unsubscribes both directions.
   *
   * Satisfies `@llui/markdown-editor`'s `CollabBinding` structurally.
   */
  register: (editor: LexicalEditor) => () => void
  /** The shared document. Hand this to your transport. */
  readonly doc: LoroDoc
  /** The root element container mirroring Lexical's `RootNode`. */
  readonly root: ElementContainer
  /** The ContainerID ↔ NodeKey registry. Exposed for tests and diagnostics. */
  readonly mapping: ContainerNodeMap
  /**
   * Install this binding's CRDT-aware undo/redo on the editor; pass as
   * `lexicalForeign({ externalUndo })`. Returns a disposer.
   *
   * Undo is LOCAL-ONLY: it reverts this peer's own commits and leaves every
   * other peer's concurrent edits standing (`undo.ts`). Registering it forces
   * `lexicalForeign`'s built-in `@lexical/history` stack off, which is the point
   * — a snapshot-based local stack would rewind remote work for everyone.
   *
   * Registration is SEPARATE from {@link LoroCollab.register} so a host that
   * genuinely wants its own undo owner can decline it. Do not register it twice.
   */
  readonly externalUndo: (editor: LexicalEditor) => () => void
  /** Re-run the boot decision — call after your transport's first sync. */
  bootstrap: (editor: LexicalEditor) => BootstrapOutcome
}
```

### `LoroCollabConfig`

```typescript
export interface LoroCollabConfig {
  /** The shared document. Created if omitted — pass your provider's doc. */
  readonly doc?: LoroDoc
  /**
   * Whether THIS peer may seed an empty shared document. Default `true`.
   * Set `false` on peers that join rather than create, and on any peer whose
   * transport has not completed its first sync — an unsynced document looks
   * empty, and seeding one races the content about to arrive.
   */
  readonly shouldBootstrap?: boolean
  /**
   * Fill an empty shared document with this peer's default content. Runs once,
   * inside a Lexical update. `@llui/markdown-editor` supplies this as
   * `CollabHooks.seed`, which converts its `defaultValue` markdown.
   */
  readonly seed?: (editor: LexicalEditor) => void
  /** Commit origin stamped on this binding's writes. Defaults to `'lexical-loro'`. */
  readonly origin?: string
  /** Called after boot with what happened — seeded, adopted, or still waiting. */
  readonly onBootstrap?: (outcome: BootstrapOutcome) => void
  /**
   * Tuning for the peer-scoped undo manager installed by
   * {@link LoroCollab.externalUndo} — merge window, stack depth, excluded
   * origins. Defaults are in `undo.ts`; the `doc` is supplied by the binding.
   */
  readonly undo?: Omit<LoroUndoOptions, 'doc'>
}
```

### `LoroUndoOptions`

Tuning for {@link registerLoroUndo}.

```typescript
export interface LoroUndoOptions {
  /** The shared document. */
  readonly doc: LoroDoc
  /** See {@link DEFAULT_MERGE_INTERVAL}. */
  readonly mergeInterval?: number
  /** See {@link DEFAULT_MAX_UNDO_STEPS}. */
  readonly maxUndoSteps?: number
  /**
   * Local commit origins EXCLUDED from the undo stack, by prefix. Use this for
   * machine-generated writes a user should never be able to undo into.
   */
  readonly excludeOriginPrefixes?: readonly string[]
}
```

### `MappingEntry`

One direction of a mapping entry, as reported by iteration and sweeps.

```typescript
export interface MappingEntry {
  readonly id: ContainerID
  readonly key: NodeKey
}
```

### `MarkOp`

An explicit format operation to apply to a `LoroText`.

```typescript
export interface MarkOp {
  readonly kind: 'mark' | 'unmark'
  /** Inclusive UTF-16 start offset. */
  readonly start: number
  /** Exclusive UTF-16 end offset. */
  readonly end: number
  readonly format: LoroTextFormat
}
```

### `OutboundTarget`

The Loro side of the binding: the document, its root mirror, and the registry.

```typescript
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
```

### `TargetElement`

A Lexical element (paragraph/heading/list/…) or a leaf mirrored as an element
(`LineBreakNode`, `LLuiDecoratorNode`) whose payload lives entirely in `props`.

```typescript
export interface TargetElement {
  readonly kind: 'element'
  readonly type: string
  readonly props: Readonly<Record<string, PropValue>>
  readonly children: readonly TargetChild[]
}
```

### `TargetText`

A maximal run of adjacent text nodes — the schema's text unit (see `schema.ts`).

```typescript
export interface TargetText {
  readonly kind: 'text'
  readonly runs: readonly TextRun[]
}
```

### `TextCarrierShape`

A text carrier's key set.

```typescript
export interface TextCarrierShape extends Record<string, unknown> {
  [KEY_UUID]: string
  [KEY_POS]: string
  [KEY_KIND]: 'text'
  [KEY_TEXT]: LoroText
}
```

### `TextDeltaItem`

A Loro text delta item, as returned by `LoroText#toDelta`.

```typescript
export interface TextDeltaItem {
  readonly insert?: unknown
  readonly attributes?: Readonly<Record<string, unknown>>
}
```

### `TextDiff`

A single-region string edit: delete `remove` chars at `index`, insert `insert`.

```typescript
export interface TextDiff {
  /** UTF-16 offset at which the change applies. */
  readonly index: number
  /** Number of UTF-16 code units to delete at `index`. */
  readonly remove: number
  /** Text to insert at `index` after the deletion. */
  readonly insert: string
}
```

### `TextRun`

A maximal stretch of text sharing one Lexical format bitmask.

```typescript
export interface TextRun {
  readonly text: string
  readonly format: number
}
```

## Classes

### `ContainerNodeMap`

A bijective, explicitly-invalidated registry mapping Loro `ContainerID`s to
Lexical `NodeKey`s. See the file header for the invariant it maintains.

```typescript
class ContainerNodeMap {
  #byContainer
  #byNode
  link(id: ContainerID, key: NodeKey): void
  nodeKey(id: ContainerID): NodeKey | undefined
  containerId(key: NodeKey): ContainerID | undefined
  expectNodeKey(id: ContainerID): NodeKey
  expectContainerId(key: NodeKey): ContainerID
  hasContainer(id: ContainerID): boolean
  hasNode(key: NodeKey): boolean
  rekey(id: ContainerID, key: NodeKey): boolean
  unlinkContainer(id: ContainerID): boolean
  unlinkNode(key: NodeKey): boolean
  entries(): MappingEntry[]
  sweep(probe: LivenessProbe): MappingEntry[]
  clear(): void
  assertBijective(): void
}
```

## Constants

### `AGENT_WRITE_ORIGIN`

Commit origin stamped on the single agent-write commit.
Distinct from `to-loro.ts`'s `OUTBOUND_ORIGIN` so the inbound path can tell an
agent write apart from an echo of its own outbound write: `binding.ts` lists
this origin among the LOCAL batches the inbound path must still APPLY, which is
what bounces an agent write into a live editor (preserving `NodeKey`s and
decorator mounts).

```typescript
const AGENT_WRITE_ORIGIN
```

### `DECORATOR_TYPE`

`type` value used for an `LLuiDecoratorNode`. Its identity lives in
`props.bridgeType`; its serialized payload in `props.data`.

```typescript
const DECORATOR_TYPE
```

### `DEFAULT_MAX_UNDO_STEPS`

Undo steps retained before the oldest is dropped. Loro's own default.

```typescript
const DEFAULT_MAX_UNDO_STEPS
```

### `DEFAULT_MERGE_INTERVAL`

Milliseconds within which consecutive local commits merge into ONE undo step.
Matches `@lexical/history`'s delay, so typing undoes in the chunks a user of
the non-collaborative editor already expects. `0` disables merging.

```typescript
const DEFAULT_MERGE_INTERVAL
```

### `DIGITS`

The key alphabet, in ascending code-unit order.
Base 62 buys ~5.9 binary subdivisions per character, which is what keeps
growth at roughly one character per five same-spot inserts. Every character
here must be ASCII and strictly ascending, because the comparator is plain
lexicographic `<` on the raw string — the same comparison every peer performs
with no locale involved.

```typescript
const DIGITS
```

### `FORMAT_BITS`

Mark name → bit value, derived from Lexical rather than hardcoded.
Built eagerly so a format this package names but Lexical does not define
fails at module load — a loud boot error instead of a format that silently
never round-trips.

```typescript
const FORMAT_BITS: Readonly<Record<LoroTextFormat, number>>
```

### `INBOUND_TAGS`

Tags stamped on every inbound writeback.
`COLLABORATION_TAG` is echo layer (b): `to-loro.ts` skips updates carrying it,
so our own writeback cannot bounce back into the shared document.
`SKIP_SCROLL_INTO_VIEW_TAG` stops a peer's edit from yanking the local
viewport.
`PROGRAMMATIC_TAG` is deliberately ABSENT and must stay that way — echo layer
(c). `packages/lexical/src/foreign.ts` treats that tag as "the host pushed new
content: cancel pending outbound work and rebase", so a remote writeback
carrying it would silently cancel the local user's in-flight debounced
`onChange` and the host's persistence would go dark whenever a peer types.

```typescript
const INBOUND_TAGS: readonly string[]
```

### `KEY_BRIDGE_TYPE`

`props` key naming which LLui bridge renders a decorator.

```typescript
const KEY_BRIDGE_TYPE
```

### `KEY_CHILDREN`

Key on an element map holding the child-carrier map.

```typescript
const KEY_CHILDREN
```

### `KEY_DATA`

`props` key holding a decorator's JSON-serialized payload.

```typescript
const KEY_DATA
```

### `KEY_KIND`

Key on a child carrier discriminating an element from a text run.
Explicit rather than inferred from which other keys are present: a remote
update can be applied partially, and a carrier whose `type` has not landed yet
must be SKIPPED by the projection, not mistaken for a text run.

```typescript
const KEY_KIND
```

### `KEY_POS`

Key on a child carrier holding its fractional index. See `order.ts`.

```typescript
const KEY_POS
```

### `KEY_PROPS`

Key on an element map holding the scalar-prop sub-map.

```typescript
const KEY_PROPS
```

### `KEY_TEXT`

Key on a TEXT carrier holding its `LoroText`.

```typescript
const KEY_TEXT
```

### `KEY_TYPE`

Key on an element map holding the Lexical node type (`node.getType()`).

```typescript
const KEY_TYPE
```

### `KEY_UUID`

Key on a child carrier holding its own uuid.
Duplicated from the `children` map key so a carrier read in isolation still
knows its identity, and so the ordering tiebreak needs no parent lookup.

```typescript
const KEY_UUID
```

### `KNOWN_FORMAT_MASK`

Every bit this binding knows how to represent.

```typescript
const KNOWN_FORMAT_MASK: number
```

### `LORO_TEXT_FORMATS`

The Lexical text formats a Loro binding represents, in bit order (see
Lexical's `LexicalConstants.ts`). Each becomes an INDEPENDENT named mark.

```typescript
const LORO_TEXT_FORMATS
```

### `LORO_UNDO_ORIGIN`

The commit origin Loro stamps on the batches produced by `UndoManager#undo`
and `#redo`. Both use `'undo'`; there is no separate redo origin.

```typescript
const LORO_UNDO_ORIGIN
```

### `OUTBOUND_ORIGIN`

Commit origin stamped on every write this module makes.

```typescript
const OUTBOUND_ORIGIN
```

### `OUTBOUND_SKIP_TAGS`

Update tags that mean "this update did not originate with the local user, do
not mirror it".
`COLLABORATION_TAG` is our own inbound writeback (echo layer b);
`SKIP_COLLAB_TAG` is Lexical's standard opt-out, which hosts use for local-only
decoration. `HISTORIC_TAG` is NOT here — see the file header.

```typescript
const OUTBOUND_SKIP_TAGS: readonly string[]
```

### `ROOT_CONTAINER`

Root map name on the `LoroDoc`. Mirrors Lexical's `RootNode`.

```typescript
const ROOT_CONTAINER
```

### `ROOT_TYPE`

The Lexical node type of the root. Matches `RootNode.getType()`.

```typescript
const ROOT_TYPE
```

### `TEXT_MARK_EXPAND`

The `expand` rule applied UNIFORMLY to every text format.
Read `test/expand-semantics.test.ts` before changing this. `expand` is NOT
the mechanism that reproduces Lexical's boundary behaviour — a 51-test spike
proved no uniform table can, and that no per-format table can either (the
divergence set is identical for all 11 formats, because Lexical has no
per-format inclusivity: its caret is uniformly left-biased). The Lexical→Loro
direction replays RESULTING NODE STATE via explicit mark/unmark ops instead
(see `diffRunFormats` in `text.ts`), which makes the local result correct
regardless of `expand`.
`expand` therefore governs exactly one thing: what happens to text a REMOTE
peer inserts CONCURRENTLY at a mark boundary. `'after'` is the closest fit to
Lexical's left-biased caret.

```typescript
const TEXT_MARK_EXPAND: ExpandType
```

### `UNDO_ORIGINS`

Local commit origins the inbound path must apply rather than treat as echo.

```typescript
const UNDO_ORIGINS: readonly string[]
```

<!-- auto-api:end -->
