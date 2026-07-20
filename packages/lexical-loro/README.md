# @llui/lexical-loro

Loro CRDT binding for the LLui ↔ Lexical editor.

> **Status: v1 — document sync, both directions, usable end to end.**
> No presence, no remote cursors, no CRDT-aware undo (undo stays Lexical's local
> history). Transport is yours to supply. See [Scope](#scope-v1).

## Usage

```ts
import { markdownEditor } from '@llui/markdown-editor'
import { loroCollab } from '@llui/lexical-loro'
import { LoroDoc } from 'loro-crdt'

const doc = new LoroDoc()
// …attach your transport to `doc` (subscribeLocalUpdates / import / export)…

markdownEditor({
  defaultValue: '# Hello',
  collab: (hooks) => loroCollab({ doc, seed: hooks.seed, shouldBootstrap: isCreator }),
})
```

`loroCollab` returns `{ register, doc, root, mapping, bootstrap }`. `register`
satisfies `@llui/markdown-editor`'s `CollabBinding` structurally, so that package
needs no Loro dependency of its own.

**There is no built-in transport, deliberately.** `LoroDoc` already exposes the
whole wire surface, so a transport is a dozen lines against your own websocket or
provider — and shipping one here would mean owning a connection lifecycle this
package cannot test honestly. Call `collab.bootstrap(editor)` again after your
transport's first sync: an unsynced document looks empty, and seeding one races
the content about to arrive.

## Design

The two directions are mirror images, and both are built around one rule.

**Never rebuild what you can mutate.** Lexical's `NodeKey` is a bare counter, so
recreating a node instead of updating it tears down its DOM, its selection, its
IME composition — and disposes the mounted LLui sub-app of every
`LLuiDecoratorNode` inside it (`packages/lexical/src/decorator.ts` disposes on
the `'destroyed'` mutation). So:

- `to-lexical.ts` resolves each remote change to an existing `NodeKey` through
  the registry and mutates that node in place. It never replaces the document,
  which is what loro-prosemirror's inbound path does — ProseMirror tolerates
  that; Lexical cannot.
- `to-loro.ts` emits one `pos` register write per moved block for a reorder
  (`n - LIS(n)` writes — the longest increasing subsequence stays put), a
  cursor-biased single-region diff for a text edit, and explicit per-format
  `mark`/`unmark` ops for formatting. It returns its op count, and the tests
  assert on it — so a pruning regression fails a test instead of quietly becoming
  a slower, mount-destroying binding.
- `mapping.ts` holds the `ContainerID ↔ NodeKey` bijection the whole thing rests
  on: `NodeKey` is per-session, `ContainerID` is the stable cross-peer address.

### How sibling order works: fractional indexing

Children are **not** stored in a list. Each child — element **or** text run — is a
carrier `LoroMap` holding `{ uuid, pos, kind, … }`, filed in its parent's
`children` map under its own random `uuid`; a text carrier holds its `LoroText`
under a `text` key, created **once** and never recreated. The rendered order is a
pure projection of replicated state: **sort by `(pos, uuid)`**.

`pos` is a fractional index — a base-62 string key with one always available
strictly between any two distinct keys — so a **same-parent move is one
last-writer-wins write to `pos`**. Nothing is deleted, nothing is recreated, and
nothing inside the moved subtree is touched. Hence `ContainerID`s (and therefore
`NodeKey`s, and therefore mounted decorator sub-apps and local carets) survive a
remote reorder; a move costs under 400 bytes regardless of subtree size; and a
concurrent edit _into_ a moved block is preserved.

Because order is derived by sorting replicated fields, peers holding the same
state cannot disagree about it — convergence is true by construction.

#### Why not `LoroMovableList`

That was this package's original design. It was abandoned because `loro-crdt`
1.13.7 (the latest release) has two defects in concurrent move/delete handling:
an uncatchable WASM panic, and a silent convergence failure where peers that have
exchanged full snapshots both ways still render different orders. Both are pinned
as `it.fails` in `test/loro-upstream.test.ts` — kept as the recorded rationale for
the schema, and to turn red if a future release fixes them.

#### Accepted tradeoffs

Real costs, deliberately chosen, each demonstrated in `test/constraints.test.ts`:

- **The concurrent-edit guarantee is same-parent only.** A **cross-parent** move
  is still delete + recreate and **does** lose a concurrent edit into the moved
  subtree. Not a regression — `LoroMovableList#move` is also single-list.
- **Delete beats move.** A delete concurrent with a move of the same block wins
  and the block vanishes, convergently, in both delivery orders. A tombstone
  mitigation was tried and **refuted by test**: the delete flag and `pos` are
  separate map keys, so both survive and nothing is rescued. Do not re-add
  tombstones.
- **`pos` keys are never rebalanced, and must not be.** A peer that inserted
  concurrently computed its key against the _old_ keys, so after a rebalance its
  block lands somewhere unrelated to what the user pointed at — convergent, and
  silently wrong about intent. It is also unnecessary: growth is linear and
  bounded (2000 adversarial same-spot inserts reach a 401-character key).
- **Two concurrent splits of the same text run garble the text.** Ordinal text
  matching mints a fresh tail container on each peer, so the merge duplicates a
  fragment. **Pre-existing** — the `LoroMovableList` binding produced the same
  result on the same history — and a property of text matching, not of the
  ordering model. Not fixed here.

### Why text formats cannot be one Loro value

`TextNode.__format` is a bitmask (`IS_BOLD = 1`, `IS_ITALIC = 1 << 1`, …).
Storing it as a single CRDT value makes two peers concurrently toggling **bold**
and **italic** a last-writer-wins conflict that silently drops one. They are
therefore independent, named Loro marks, which converge to the union.

Loro's `expand` rule cannot reproduce Lexical's boundary behaviour — a 51-test
spike (`test/expand-semantics.test.ts`) proved no uniform table works and no
per-format table can, because Lexical's caret is uniformly left-biased. So the
outbound direction replays the RESULTING node state as explicit mark/unmark ops,
and `expand` governs only what happens to text a remote peer inserts
concurrently at a mark boundary.

### Echo suppression

Three layers, all required; `binding.ts` documents what breaks without each. The
one with no code to enforce it: this binding **never emits `PROGRAMMATIC_TAG`**,
because `packages/lexical/src/foreign.ts` reads that tag as "the host pushed
content — cancel pending outbound work", which would make the host's persistence
go dark whenever a peer types.

## Scope (v1)

- **Document sync only.** No presence or remote cursors — Loro's
  `EphemeralStore` makes those additive, later work.
- **Undo is Lexical's local history, and it is NOT collaboration-safe.** This
  binding installs no `externalUndo` owner, so a host must **not** disable its
  built-in history for it. (`@llui/markdown-editor` currently passes
  `history: false` whenever `collab` is set, which was written for the Yjs
  binding — with a Loro binding that leaves the user with no undo at all.)

  The sharper limitation: `@lexical/history` has no notion of a collaboration
  tag, so an inbound remote edit is recorded as if the local user made it.
  **Undoing after a remote edit re-applies a snapshot predating that edit and
  removes the remote block for everyone.** The document stays convergent and
  well-formed, but the result is not what the user asked for. Tagging cannot fix
  it — the defect is snapshot-vs-operation — so the fix is a CRDT-aware
  `UndoManager`. Pinned by a test in `test/harden.test.ts` that asserts today's
  behaviour, ready to turn green when one lands.

- **Text-node `style`, `mode` and `detail` are not represented**; the run model
  is `{ text, format }`.

## Triaging a suspected convergence bug

Exchange full snapshots between peers and compare `doc.toJSON()`. If the
**documents** differ, the problem is below this binding and not fixable here.
Only if the documents agree while the **editors** differ is it ours.

## Testing

`test/network.ts` is a multi-peer in-memory network with delay, reordering and
disconnect knobs; `test/convergence.test.ts` and `test/convergence-attack.test.ts`
drive the real binding through it, ending in randomized three-peer property
tests. Raising their round counts is how you hunt for new bugs — it is what found
every real defect fixed so far.

`test/constraints.test.ts` is different in kind: rather than testing that the
code honours the ordering rules, it demonstrates **what breaks without them**. A
failure there may be the cost of a deliberate tradeoff rather than a bug — read
the comment before "fixing" one.

## Peer dependencies

`lexical`, `@llui/lexical` and `loro-crdt` are peer dependencies — install them
in the host application so exactly one copy of each is deduped across the app and
this package.

## License

MIT
