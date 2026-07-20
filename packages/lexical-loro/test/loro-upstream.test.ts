/**
 * WHY THIS PACKAGE DOES NOT USE `LoroMovableList` — the evidence, kept executable.
 *
 * This file is NOT a list of defects the binding lives with. It is the RATIONALE
 * for the schema in `schema.ts`: an element's children are carrier maps ordered
 * by a fractional index (`order.ts`), and a move is one LWW write to a `pos`
 * register. The obvious alternative — and this package's original design — was
 * `LoroMovableList`, whose `move` does exactly what the schema needs.
 *
 * It was abandoned because of the two defects reproduced below, in loro-crdt
 * 1.13.7 (the latest release). Both live in `LoroMovableList`'s handling of
 * concurrent move/delete histories, both are reproduced here with NO Lexical and
 * none of this package's code, and neither has a workaround at this layer:
 *
 *  1. A WASM PANIC (below) — loud, uncatchable, stops the app.
 *  2. A SILENT CONVERGENCE FAILURE (further down) — peers that have exchanged
 *     full snapshots in both directions still render different orders. Worse
 *     than the panic: nothing signals it and no further syncing repairs it.
 *
 * NEITHER IS REACHABLE FROM THE SHIPPING SCHEMA, because no `LoroMovableList`
 * remains in `src/`. Sibling order is now a pure projection of replicated state
 * (sort by `(pos, uuid)`), which is commutative by construction and so cannot
 * diverge the way defect 2 does. The costs the fractional index pays INSTEAD —
 * same-parent-only move preservation, delete-beats-move, and unbounded-but-linear
 * key growth — are documented in `schema.ts` and demonstrated in
 * `test/constraints.test.ts`.
 *
 * ── Why the pins are KEPT ──────────────────────────────────────────────────
 *
 * `it.fails` asserts each defect is STILL present. A loro-crdt release that
 * fixes one turns this file RED, which is useful signal in both directions: it
 * confirms the upstream reports were acted on, and it is the moment to
 * re-evaluate whether the simpler `LoroMovableList` schema has become viable
 * again. Until then, deleting this file would leave the schema's central design
 * decision resting on nothing but a comment.
 *
 * ── Defect 1: the panic ────────────────────────────────────────────────────
 *
 * `LoroMovableList` panics inside the WASM core —
 * `crates/loro-internal/src/state/movable_list_state.rs:1210`,
 * "called `Option::unwrap()` on a `None` value" — after a particular history of
 * CONCURRENT move/delete/insert operations across three peers.
 *
 * It was reachable in production, not a theoretical edge: block reorder is a
 * first-class operation in an editor, and the package's randomized three-peer
 * convergence test hit this within roughly 100 rounds of editing. A Rust panic
 * unwound into JS leaves the document's internal state unspecified, so it cannot
 * be caught and recovered from — the only workaround was to stop using `move`,
 * which is what the fractional index accomplishes.
 *
 * The reproduction was found by delta-debugging a randomized run down from 60
 * operations to these three.
 */

import { describe, expect, it } from 'vitest'
import { LoroDoc, LoroMap, LoroMovableList } from 'loro-crdt'

const peerDoc = (peer: bigint): LoroDoc => {
  const doc = new LoroDoc()
  doc.setPeerId(peer)
  return doc
}

const sharedList = (doc: LoroDoc): LoroMovableList => doc.getMovableList('l') as LoroMovableList

/** One peer operation, plus which peers drain their inbox afterwards. */
interface Step {
  readonly peer: number
  readonly kind: 'insert' | 'delete' | 'move'
  readonly from: number
  readonly to: number
  readonly deliver: readonly boolean[]
}

/**
 * Three peers over one movable list of four container elements, with updates
 * held per peer so operations can be made concurrently.
 */
function replay(steps: readonly Step[]): void {
  const docs = [peerDoc(1n), peerDoc(2n), peerDoc(3n)]
  const first = sharedList(docs[0]!)
  for (let i = 0; i < 4; i++) {
    const element = first.insertContainer(first.length, new LoroMap())
    element.set('t', String(i))
  }
  docs[0]!.commit()
  const snapshot = docs[0]!.export({ mode: 'snapshot' })
  for (const doc of docs.slice(1)) doc.import(snapshot)

  const inbox: Uint8Array[][] = docs.map(() => [])
  for (const [index, doc] of docs.entries()) {
    doc.subscribeLocalUpdates((bytes) => {
      for (const [other] of docs.entries()) if (other !== index) inbox[other]!.push(bytes)
    })
  }

  for (const step of steps) {
    const doc = docs[step.peer]!
    const list = sharedList(doc)
    const size = list.length
    if (step.kind === 'insert') {
      list.insertContainer(Math.min(step.from, size), new LoroMap()).set('t', 'x')
    } else if (step.kind === 'delete') {
      if (size > 1) list.delete(Math.min(step.from, size - 1), 1)
    } else if (size > 1) {
      const from = Math.min(step.from, size - 1)
      const to = Math.min(step.to, size - 1)
      if (from !== to) list.move(from, to)
    }
    doc.commit()
    for (const [index, other] of docs.entries()) {
      if (!step.deliver[index]) continue
      for (const bytes of inbox[index]!) other.import(bytes)
      inbox[index]!.length = 0
    }
  }
}

/**
 * Replay `steps`, then force a FULL bidirectional snapshot exchange (twice) and
 * report whether every peer's `toJSON()` agrees.
 *
 * The exhaustive exchange is the point: it removes every explanation except an
 * upstream one. Three documents that have exchanged complete snapshots in both
 * directions hold identical op histories by construction, so a difference in
 * their materialized state is a defect in how `LoroMovableList` folds that
 * history — not missing data, not delivery order, not anything a caller controls.
 */
function convergesAfterFullExchange(steps: readonly Step[]): boolean {
  const docs = [peerDoc(1n), peerDoc(2n), peerDoc(3n)]
  const first = sharedList(docs[0]!)
  for (let i = 0; i < 4; i++) {
    const element = first.insertContainer(first.length, new LoroMap())
    element.set('t', String(i))
  }
  docs[0]!.commit()
  const snapshot = docs[0]!.export({ mode: 'snapshot' })
  for (const doc of docs.slice(1)) doc.import(snapshot)

  const inbox: Uint8Array[][] = docs.map(() => [])
  for (const [index, doc] of docs.entries()) {
    doc.subscribeLocalUpdates((bytes) => {
      for (const [other] of docs.entries()) if (other !== index) inbox[other]!.push(bytes)
    })
  }

  for (const step of steps) {
    const doc = docs[step.peer]!
    const list = sharedList(doc)
    const size = list.length
    if (step.kind === 'insert') {
      list.insertContainer(Math.min(step.from, size), new LoroMap()).set('t', 'x')
    } else if (step.kind === 'delete') {
      if (size > 0) list.delete(Math.min(step.from, size - 1), 1)
    } else if (size > 1) {
      const from = Math.min(step.from, size - 1)
      const to = Math.min(step.to, size - 1)
      if (from !== to) list.move(from, to)
    }
    doc.commit()
    for (const [index, other] of docs.entries()) {
      if (!step.deliver[index]) continue
      for (const bytes of inbox[index]!) other.import(bytes)
      inbox[index]!.length = 0
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    for (const x of docs) {
      for (const y of docs) {
        if (x !== y) y.import(x.export({ mode: 'snapshot' }))
      }
    }
  }

  const rendered = docs.map((doc) => JSON.stringify(doc.toJSON()))
  return rendered.every((value) => value === rendered[0])
}

describe('loro-crdt 1.13.7 — the upstream defects that rule out LoroMovableList', () => {
  it.fails('LoroMovableList panics on a move against a concurrent delete', () => {
    replay([
      // Peer 0 inserts; only peer 1 hears about it.
      { peer: 0, kind: 'insert', from: 1, to: 3, deliver: [false, true, false] },
      // Peer 2 concurrently deletes; again only peer 1 hears about it.
      { peer: 2, kind: 'delete', from: 4, to: 5, deliver: [false, true, false] },
      // Peer 0 moves, then drains — and the WASM core panics.
      { peer: 0, kind: 'move', from: 4, to: 2, deliver: [true, false, true] },
    ])
  })

  /**
   * The second, DISTINCT upstream defect: `LoroMovableList` peers can fail to
   * CONVERGE at all — no panic, no error, just three documents that have
   * exchanged full snapshots both ways and still render different orders.
   *
   * This is strictly worse than the panic. A panic is loud and stops the app; a
   * silent convergence failure means two users are looking at permanently
   * different documents with no indication anything is wrong, and no amount of
   * further syncing repairs it.
   *
   * Found by randomized search over pure loro-crdt operations and delta-debugged
   * to these five steps — no Lexical, none of this package's code. It was the
   * root cause of the only randomized-editing divergence the package's own
   * convergence suite could not attribute to its own logic, and it is the
   * decisive argument for the fractional index: an order derived by SORTING
   * replicated fields cannot disagree between peers that hold the same state,
   * whereas a replicated list's internal move resolution can.
   */
  it.fails('LoroMovableList peers fail to converge after concurrent move/delete', () => {
    const converged = convergesAfterFullExchange([
      { peer: 1, kind: 'delete', from: 2, to: 1, deliver: [true, true, false] },
      { peer: 2, kind: 'move', from: 4, to: 1, deliver: [false, false, false] },
      { peer: 1, kind: 'move', from: 2, to: 1, deliver: [true, false, false] },
      { peer: 2, kind: 'insert', from: 0, to: 1, deliver: [false, true, false] },
      { peer: 2, kind: 'move', from: 2, to: 3, deliver: [true, false, true] },
    ])
    expect(converged).toBe(true)
  })
})
