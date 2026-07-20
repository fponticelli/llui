/**
 * THE EVIDENCE BEHIND THE ORDERING CONSTRAINTS.
 *
 * `order.ts` opens with four numbered constraints, and `schema.ts` records three
 * accepted costs. Each one is a REAL defect that was reproduced during design,
 * and each is the kind of rule a later contributor deletes because it reads like
 * defensive noise. Elsewhere the suite tests that the code HONOURS the rules;
 * this file demonstrates WHAT BREAKS WITHOUT THEM, so the reason survives the
 * person who found it.
 *
 * These began as throwaway spikes (`spike-round2`, `spike-fractional-order`,
 * `spike-round3-lexical`). Those spikes carried a parallel toy schema; this file
 * deliberately does NOT — every test drives the real `order.ts` / `schema.ts`, so
 * it keeps failing if production drifts, which the spikes never would have.
 *
 * A test here that starts failing is not necessarily a bug: several assert the
 * cost of a DELIBERATE tradeoff. Read the comment before "fixing" one.
 */

import { describe, expect, it } from 'vitest'
import { LoroDoc, LoroMap, LoroText } from 'loro-crdt'

import {
  allocate,
  allocateAt,
  between,
  createTextChild,
  elementChildren,
  initDoc,
  jitterFor,
  KEY_CHILDREN,
  KEY_POS,
  LORO_TEXT_FORMATS,
  newUuid,
  orderedChildren,
  ROOT_CONTAINER,
  setChildPosition,
  type ElementContainer,
} from '../src/index.js'
import { appendElement, appendText, childAt, childTypes, moveChild } from './children.js'

const freshDoc = (peer: bigint): { doc: LoroDoc; root: ElementContainer } => {
  const doc = new LoroDoc()
  doc.setPeerId(peer)
  return { doc, root: initDoc(doc, LORO_TEXT_FORMATS) }
}

/** Every peer sends to every other, twice, so all of them are fully merged. */
const fullExchange = (docs: readonly LoroDoc[]): void => {
  for (const from of docs) {
    const update = from.export({ mode: 'update' })
    for (const to of docs) if (to !== from) to.import(update)
  }
  for (const from of docs) {
    const update = from.export({ mode: 'update' })
    for (const to of docs) if (to !== from) to.import(update)
  }
}

/** The rendered child order, as text, for comparing peers. */
const rendered = (root: ElementContainer): string[] =>
  orderedChildren(root).map((entry) =>
    entry.kind === 'text' ? (entry.container as LoroText).toString() : `<${entry.uuid}>`,
  )

// ===========================================================================
// CONSTRAINT 2 — jitter per BATCH, never per insert
// ===========================================================================

describe('constraint 2 — why jitter is ignored for a single insert', () => {
  /**
   * The worst case for key growth: every insert lands between the same left
   * neighbour and the previous insert, halving the live interval each time.
   * Driven through the allocator directly, because key length is a property of
   * the generator and routing it through Loro would only measure Loro.
   */
  const adversarialLeft = (count: number, jitter: string | null): number => {
    let after = 'z'
    for (let i = 0; i < count; i++) after = allocate('a', after, 1, jitter)[0]!
    return after.length
  }

  const adversarialRight = (count: number, jitter: string | null): number => {
    let before = 'a'
    for (let i = 0; i < count; i++) before = allocate(before, 'z', 1, jitter)[0]!
    return before.length
  }

  /**
   * The SAME walk with the `count === 1` guard removed — i.e. what `allocate`
   * would compute if a contributor deleted that branch, which is exactly the
   * anchor formula its `count > 1` path already uses (`between(...) + jitter`).
   *
   * It has to be modelled here rather than driven through `allocate`, because
   * the guard under test is precisely what makes the degraded curve unreachable
   * from the real entry point. Keeping the formula identical to `allocate`'s own
   * anchor line is what makes it a faithful counterfactual.
   */
  const unguardedLeft = (count: number, jitter: string): number => {
    let after = 'z'
    for (let i = 0; i < count; i++) after = between('a', after) + jitter
    return after.length
  }

  const unguardedRight = (count: number, jitter: string): number => {
    let before = 'a'
    for (let i = 0; i < count; i++) before = between(before, 'z') + jitter
    return before.length
  }

  /**
   * THE MEASUREMENT THAT JUSTIFIES THE `count === 1` BRANCH IN `allocate`.
   *
   * A suffix digit at the far end of the alphabet from the direction of travel
   * consumes the whole remaining interval, so every subsequent key must walk
   * past it: growth degrades from ~0.2 to ~1.0 characters per insert, a 5x
   * regression. Crucially the pathological digit is DIRECTION-DEPENDENT — low is
   * worst going left, high is worst going right — so there is no fixed per-peer
   * digit that is safe in both, and "just always jitter" cannot be rescued by
   * picking a better alphabet position.
   *
   * Deleting the `count === 1` branch in `allocate` makes this test fail.
   */
  it('shows always-on jitter degrades growth, and the bad digit flips with direction', () => {
    // Baseline, no jitter: ~0.20 and ~0.17 characters per insert.
    expect(adversarialLeft(2000, null)).toBe(401)
    expect(adversarialRight(2000, null)).toBe(334)

    // Left-adversarial: a LOW digit is pathological — 1.0 chars per insert.
    expect(unguardedLeft(2000, '2')).toBe(1998)
    expect(unguardedLeft(2000, 'V')).toBe(501)
    expect(unguardedLeft(2000, 'z')).toBe(402)

    // Right-adversarial: the ranking INVERTS. The best digit for one direction
    // is the worst for the other, so no fixed per-peer digit is safe in both.
    expect(unguardedRight(2000, 'z')).toBe(668)
    expect(unguardedRight(2000, 'V')).toBe(401)
    expect(unguardedRight(2000, '2')).toBe(335)

    // The guard is worth ~5x against the worst digit a peer could draw.
    expect(unguardedLeft(2000, '2') / adversarialLeft(2000, '2')).toBeGreaterThan(4)
  })

  it('routes single inserts around the jitter, whatever digit the peer drew', () => {
    // The guarantee the branch provides: for count === 1 the jitter is inert, so
    // no peer can be unlucky enough to hit the degraded curve above.
    for (const peer of [1n, 7n, 42n, 61n]) {
      expect(adversarialLeft(500, jitterFor(peer))).toBe(adversarialLeft(500, null))
      expect(adversarialRight(500, jitterFor(peer))).toBe(adversarialRight(500, null))
    }
  })
})

// ===========================================================================
// CONSTRAINT 3 — never rebalance
// ===========================================================================

describe('constraint 3 — why rebalancing is unsafe, not merely unnecessary', () => {
  /**
   * THE "OPTIMIZATION" A FUTURE CONTRIBUTOR WILL PROPOSE.
   *
   * Key growth is linear, so spreading every `pos` out evenly looks like free
   * housekeeping. It is not: a peer that concurrently inserted computed its key
   * against the OLD keys, so after the merge its block lands somewhere
   * unrelated to what the user pointed at. The result still CONVERGES — every
   * peer agrees on the wrong answer — which is exactly why this cannot be caught
   * by a convergence test and needs an intent assertion.
   */
  it('converges but SILENTLY relocates a block a peer inserted concurrently', () => {
    // Direct text children of the root, so `rendered` reports the LABELS — the
    // assertion below is about which neighbours the block landed between, and it
    // would be vacuous against opaque element carriers.
    //
    // The keys are deliberately SKEWED (head and tail, then four inserts at
    // index 1), because that is the state that motivates a rebalance in the
    // first place. Seeding by plain appends would be a no-op rebalance: an
    // even spread generates exactly the keys appending already produced, so the
    // defect would be invisible and the test would pass for the wrong reason.
    const insertAt = (doc: LoroDoc, root: ElementContainer, index: number, label: string): void => {
      const positions = orderedChildren(root).map((entry) => entry.pos)
      const [pos] = allocateAt(positions, index, 1, null)
      createTextChild(elementChildren(root), newUuid(), pos!).insert(0, label)
      doc.commit()
    }

    const { doc: a, root: rootA } = freshDoc(1n)
    insertAt(a, rootA, 0, 'head')
    insertAt(a, rootA, 1, 'tail')
    for (const name of ['b3', 'b2', 'b1', 'b0']) insertAt(a, rootA, 1, name)
    expect(rendered(rootA)).toEqual(['head', 'b0', 'b1', 'b2', 'b3', 'tail'])
    // Skewed, which is what a rebalance would claim to fix.
    expect(orderedChildren(rootA).map((entry) => entry.pos)).toEqual([
      'V',
      'VV',
      'W',
      'Y',
      'c',
      'k',
    ])

    const { doc: b, root: rootB } = freshDoc(2n)
    b.import(a.export({ mode: 'snapshot' }))

    // Peer A rebalances: every child re-laid-out evenly from scratch.
    const entries = orderedChildren(rootA)
    const keys = allocate(null, null, entries.length, null)
    entries.forEach((entry, index) => setChildPosition(entry.carrier, keys[index]!))
    a.commit()

    // Peer B concurrently inserts between b2 and b3, using PRE-rebalance keys.
    const positions = orderedChildren(rootB).map((entry) => entry.pos)
    const [pos] = allocateAt(positions, 4, 1, jitterFor(2n))
    createTextChild(elementChildren(rootB), newUuid(), pos!).insert(0, 'NEW')
    b.commit()

    fullExchange([a, b])

    // Convergent — and that is the trap. A convergence test cannot catch this.
    expect(rendered(rootA)).toEqual(rendered(rootB))

    // The user asked for it between b2 and b3. It landed at the FRONT, four
    // slots away, between head and b0 — nowhere near what was pointed at.
    expect(rendered(rootA)).toEqual(['head', 'NEW', 'b0', 'b1', 'b2', 'b3', 'tail'])
  })

  it('keeps growth bounded enough that rebalancing is never needed anyway', () => {
    // The other half of the argument: the cost being "fixed" is small. 2000
    // adversarial same-spot inserts, and a move still carries one short key.
    let after = 'z'
    for (let i = 0; i < 2000; i++) after = allocate('a', after, 1, null)[0]!
    expect(after.length).toBe(401)
    expect(after.length).toBeLessThan(1024)
  })
})

// ===========================================================================
// CONSTRAINT 4 — equal positions are reachable
// ===========================================================================

describe('constraint 4 — equal positions, and why `allocateAt` is the only entry point', () => {
  /**
   * REACHABILITY FIRST: this is not a theoretical state. Two peers inserting at
   * the same slot with no jitter (the single-insert path — see constraint 2)
   * mint an IDENTICAL `pos`.
   */
  it('two concurrent single inserts at the same slot mint an IDENTICAL pos', () => {
    const { doc: a, root: rootA } = freshDoc(1n)
    appendText(appendElement(rootA, 'paragraph')).insert(0, 'head')
    appendText(appendElement(rootA, 'paragraph')).insert(0, 'tail')
    a.commit()

    const { doc: b, root: rootB } = freshDoc(2n)
    b.import(a.export({ mode: 'snapshot' }))

    for (const [doc, root, label] of [
      [a, rootA, 'from-A'],
      [b, rootB, 'from-B'],
    ] as const) {
      const positions = orderedChildren(root).map((entry) => entry.pos)
      const [pos] = allocateAt(positions, 1, 1, null)
      createTextChild(elementChildren(root), newUuid(), pos!).insert(0, label)
      doc.commit()
    }
    fullExchange([a, b])

    const entries = orderedChildren(rootA)
    const fromA = entries.find((e) => (e.container as LoroText).toString?.() === 'from-A')
    const fromB = entries.find((e) => (e.container as LoroText).toString?.() === 'from-B')
    expect(fromA!.pos).toBe(fromB!.pos)
  })

  /**
   * …and what raw `between` does with that state. It TERMINATES — once both
   * strings are exhausted the upper bound widens to the whole alphabet and a gap
   * always opens — but the key it returns sorts AFTER BOTH inputs while claiming
   * to sort between them. Silent misordering of the one invariant this module
   * exists to maintain.
   *
   * This is why `between` is documented as REQUIRING `a < b` and why callers are
   * routed through `allocateAt` instead.
   */
  it('`between` on two EQUAL keys returns a key OUTSIDE the interval', () => {
    const key = between('1V', '1V')
    expect(key).toBe('1VV')
    expect(key > '1V').toBe(true)
    // The property it is supposed to guarantee, violated.
    expect(key < '1V').toBe(false)
  })

  /**
   * The end-to-end consequence of calling `between` directly, and the reason
   * `allocateAt` — which can SEE the sibling list — is the only safe entry
   * point. Asked for index 1; got index 2.
   */
  it('a raw `between` insert between two equal-pos siblings lands AFTER both', () => {
    const { doc, root } = freshDoc(1n)
    const children = elementChildren(root)
    createTextChild(children, 'aaa', '1V').insert(0, 'a')
    createTextChild(children, 'zzz', '1V').insert(0, 'z')
    doc.commit()
    expect(rendered(root)).toEqual(['a', 'z'])

    const entries = orderedChildren(root)
    createTextChild(children, 'mid', between(entries[0]!.pos, entries[1]!.pos)).insert(0, 'm')
    doc.commit()

    expect(rendered(root)).toEqual(['a', 'z', 'm'])
  })

  /**
   * `allocateAt` on the same document. It cannot place the block between two
   * equal keys either — no such key exists — but it WIDENS past the degenerate
   * group instead of emitting one that breaks the sort. One slot late, and the
   * invariant intact. That is the deliberate tradeoff.
   */
  it('`allocateAt` widens past the equal group rather than emitting a bad key', () => {
    const { doc, root } = freshDoc(1n)
    const children = elementChildren(root)
    createTextChild(children, 'aaa', '1V').insert(0, 'a')
    createTextChild(children, 'zzz', '1V').insert(0, 'z')
    doc.commit()

    const positions = orderedChildren(root).map((entry) => entry.pos)
    const [pos] = allocateAt(positions, 1, 1, null)
    createTextChild(children, 'mid', pos!).insert(0, 'm')
    doc.commit()

    // Same visible outcome as the raw call above — but reached WITHOUT ever
    // producing a key that contradicts its own interval, so the sort stays a
    // total order and later inserts still behave.
    expect(rendered(root)).toEqual(['a', 'z', 'm'])
    expect(pos! > '1V').toBe(true)
  })
})

// ===========================================================================
// CONSTRAINT 5 — uuids must be random
// ===========================================================================

describe('constraint 5 — uuids must be random, never derived', () => {
  /**
   * A carrier lives in ONE map slot, which is a last-writer-wins register. Two
   * peers that mint the same uuid concurrently do not merge: one peer's entire
   * block — its text, its ContainerID, its whole subtree — is silently
   * discarded. This is why `newUuid` uses `crypto.randomUUID` and why deriving a
   * uuid from content, index or peer id is unsafe.
   */
  it('silently discards one whole block when two peers mint the SAME uuid', () => {
    const { doc: a, root: rootA } = freshDoc(1n)
    appendText(appendElement(rootA, 'paragraph')).insert(0, 'head')
    a.commit()

    const { doc: b, root: rootB } = freshDoc(2n)
    b.import(a.export({ mode: 'snapshot' }))

    // The collision: both peers choose 'collision' as the uuid.
    for (const [doc, root, label] of [
      [a, rootA, 'from-A'],
      [b, rootB, 'from-B'],
    ] as const) {
      const positions = orderedChildren(root).map((entry) => entry.pos)
      const [pos] = allocateAt(positions, positions.length, 1, jitterFor(doc.peerId))
      createTextChild(elementChildren(root), 'collision', pos!).insert(0, label)
      doc.commit()
    }
    fullExchange([a, b])

    // Convergent, and one of the two blocks is simply gone.
    expect(rendered(rootA)).toEqual(rendered(rootB))
    const survivors = rendered(rootA).filter((entry) => entry.startsWith('from-'))
    expect(survivors).toHaveLength(1)
  })

  it('`newUuid` does not collide across a large batch', () => {
    const uuids = new Set(Array.from({ length: 10_000 }, () => newUuid()))
    expect(uuids.size).toBe(10_000)
  })
})

// ===========================================================================
// CONSTRAINT 6 — same-parent only
// ===========================================================================

describe('constraint 6 — the concurrent-edit guarantee is SAME-PARENT only', () => {
  /**
   * DO NOT OVERSTATE THE HEADLINE CLAIM. A same-parent move is one `pos` write,
   * so a concurrent edit into the moved subtree survives — that is tested in
   * `schema.test.ts`. A CROSS-PARENT move is still delete + recreate, and it
   * still loses the concurrent edit.
   *
   * This is NOT a regression the fractional index introduced: `LoroMovableList`
   * is also single-list, so its `move` could not span parents either. But the
   * README and the docs must say "same-parent", and this test is what keeps that
   * qualifier honest.
   */
  it('LOSES a concurrent subtree edit on a CROSS-PARENT move', () => {
    const { doc: a, root: rootA } = freshDoc(1n)
    const source = appendElement(rootA, 'quote')
    const target = appendElement(rootA, 'quote')
    const moving = appendElement(source, 'paragraph')
    const text = appendText(moving)
    text.insert(0, 'hello')
    a.commit()

    const { doc: b, root: rootB } = freshDoc(2n)
    b.import(a.export({ mode: 'snapshot' }))

    // A moves the paragraph into the OTHER quote: delete here, recreate there.
    const entry = orderedChildren(source)[0]!
    const positions = orderedChildren(target).map((other) => other.pos)
    const [pos] = allocateAt(positions, 0, 1, null)
    const recreated = appendElement(target, 'paragraph')
    setChildPosition(orderedChildren(target)[0]!.carrier, pos!)
    appendText(recreated).insert(0, text.toString())
    elementChildren(source).delete(entry.uuid)
    a.commit()

    // B concurrently types into the paragraph, at its ORIGINAL address.
    const remote = b.getContainerById(text.id) as LoroText
    remote.insert(5, ' world')
    b.commit()

    fullExchange([a, b])

    // Convergent, but B's ' world' is gone: it landed in a container that the
    // cross-parent move deleted.
    for (const root of [rootA, rootB]) {
      const moved = childAt(root, 1) as ElementContainer
      expect(childTypes(moved)).toEqual(['paragraph'])
      const survivor = childAt(moved, 0) as ElementContainer
      expect((childAt(survivor, 0) as LoroText).toString()).toBe('hello')
    }
  })
})

// ===========================================================================
// CONSTRAINT 7 — delete beats move, and tombstones do not help
// ===========================================================================

describe('constraint 7 — delete beats move, and the tombstone mitigation is refuted', () => {
  /**
   * The accepted loss: a peer deleting a block wins over a peer moving it. The
   * block vanishes. It is convergent in BOTH delivery orders, which is what
   * makes it acceptable rather than merely unfortunate — no peer is left with a
   * phantom.
   */
  it('lets a concurrent delete beat a concurrent move, convergently, both orders', () => {
    for (const deleteFirst of [true, false]) {
      const { doc: a, root: rootA } = freshDoc(1n)
      for (const name of ['x', 'y', 'z']) {
        appendText(appendElement(rootA, 'paragraph')).insert(0, name)
      }
      a.commit()

      const { doc: b, root: rootB } = freshDoc(2n)
      b.import(a.export({ mode: 'snapshot' }))

      // A deletes the middle block; B moves it to the front.
      elementChildren(rootA).delete(orderedChildren(rootA)[1]!.uuid)
      a.commit()
      moveChild(rootB, 1, 0)
      b.commit()

      const updateA = a.export({ mode: 'update' })
      const updateB = b.export({ mode: 'update' })
      if (deleteFirst) {
        b.import(updateA)
        a.import(updateB)
      } else {
        a.import(updateB)
        b.import(updateA)
      }
      fullExchange([a, b])

      // The block is gone on both peers, in both delivery orders.
      expect(childTypes(rootA)).toEqual(['paragraph', 'paragraph'])
      expect(rendered(rootA)).toEqual(rendered(rootB))
    }
  })

  /**
   * THE MITIGATION THAT DOES NOT WORK — recorded so it is not re-attempted.
   *
   * The idea: delete by setting a flag instead of removing the map key, so a
   * concurrent `pos` write has something to land on and the block can be
   * "rescued". It fails, because the flag and `pos` are SEPARATE map keys and
   * both survive the merge independently: the delete flag is still true, so the
   * block is still hidden, and the mover's intent is still lost. All the
   * tombstone buys is unbounded growth — deleted carriers are never reclaimed.
   *
   * `schema.ts` says "do not re-add tombstones". This is why.
   */
  it('a tombstone flag does NOT rescue the moved block, and costs unbounded growth', () => {
    const { doc: a, root: rootA } = freshDoc(1n)
    for (const name of ['x', 'y', 'z']) {
      appendText(appendElement(rootA, 'paragraph')).insert(0, name)
    }
    a.commit()

    const { doc: b, root: rootB } = freshDoc(2n)
    b.import(a.export({ mode: 'snapshot' }))

    const targetUuid = orderedChildren(rootA)[1]!.uuid

    // A "deletes" by flag rather than by removing the key.
    orderedChildren(rootA)[1]!.carrier.set('deleted', true)
    a.commit()
    // B concurrently moves the same block to the front.
    moveChild(rootB, 1, 0)
    b.commit()
    fullExchange([a, b])

    // Both writes landed — and they do not interact. The flag still reads true,
    // so a projection honouring it still hides the block: nothing was rescued.
    const carrier = orderedChildren(rootA).find((entry) => entry.uuid === targetUuid)!.carrier
    expect(carrier.get('deleted')).toBe(true)

    // And the carrier is now permanently resident, which is the unbounded cost.
    expect(orderedChildren(rootA)).toHaveLength(3)
    expect(rendered(rootA)).toEqual(rendered(rootB))
  })
})

// ===========================================================================
// RESILIENCE — states a partially applied remote update can produce
// ===========================================================================

describe('resilience of the ordering projection', () => {
  it('recovers from an emptied children map — an empty list is an open interval', () => {
    const { doc, root } = freshDoc(1n)
    appendText(appendElement(root, 'paragraph')).insert(0, 'a')
    appendText(appendElement(root, 'paragraph')).insert(0, 'b')
    doc.commit()

    for (const entry of orderedChildren(root)) elementChildren(root).delete(entry.uuid)
    doc.commit()
    expect(orderedChildren(root)).toHaveLength(0)

    // Allocating into an empty list must not strand the allocator.
    const [pos] = allocateAt([], 0, 1, jitterFor(1n))
    createTextChild(elementChildren(root), newUuid(), pos!).insert(0, 'c')
    doc.commit()
    expect(rendered(root)).toEqual(['c'])
  })

  it('skips a carrier whose pos is present but NOT A STRING', () => {
    // `schema.test.ts` covers the missing-key cases; this is the wrong-TYPE one.
    //
    // It has to be written by a genuinely FOREIGN peer, and that is the point
    // rather than a workaround: `ChildCarrier` types `pos` as a string, so this
    // document is unreachable from our own writers. The only way it can arrive
    // is over the wire from a different or future implementation — which is
    // exactly the case the `typeof pos !== 'string'` guard in `orderedChildren`
    // exists for. The projection runs inside Lexical's update cycle, where a
    // throw corrupts the editor state, so skipping is mandatory.
    const { doc, root } = freshDoc(1n)
    const [pos] = allocateAt([], 0, 1, null)
    createTextChild(elementChildren(root), newUuid(), pos!).insert(0, 'good')
    doc.commit()

    const foreign = new LoroDoc()
    foreign.setPeerId(9n)
    foreign.import(doc.export({ mode: 'snapshot' }))
    const foreignChildren = foreign.getMap(ROOT_CONTAINER).get(KEY_CHILDREN)
    expect(foreignChildren).toBeInstanceOf(LoroMap)
    if (foreignChildren instanceof LoroMap) {
      const carrier = foreignChildren.setContainer(newUuid(), new LoroMap())
      carrier.set(KEY_POS, 42)
      carrier.set('kind', 'text')
    }
    foreign.commit()
    doc.import(foreign.export({ mode: 'update' }))

    // The malformed carrier really did arrive — it is simply not projected.
    expect(elementChildren(root).size).toBe(2)
    expect(rendered(root)).toEqual(['good'])
  })

  it('projects in sub-quadratic time (the sort is O(n log n), not O(n^2))', () => {
    // The children map has no order of its own, so every projection sorts. What
    // matters is that the sort stays O(n log n): a regression that made it
    // quadratic (e.g. an indexOf-in-a-loop) would block the main thread on a
    // large document. We assert that SHAPE via a scaling ratio rather than an
    // absolute wall-clock bound — a fixed millisecond threshold is unportable
    // across CI runners (it flaked at 16ms on a shared box), whereas the ratio
    // between two sizes is machine-speed-invariant. For a 4x size increase,
    // O(n log n) grows ~4.9x and O(n^2) grows 16x; a threshold of 12 separates
    // them (a true quadratic still fails hard) while leaving headroom for
    // measurement noise on a loaded CI runner.
    const project = (n: number): number => {
      const { doc, root } = freshDoc(1n)
      const children = elementChildren(root)
      const keys = allocate(null, null, n, jitterFor(1n))
      for (let i = 0; i < n; i++) createTextChild(children, newUuid(), keys[i]!)
      doc.commit()
      // Warm up, then average enough iterations that each measurement is
      // comfortably in the multi-millisecond range (sub-millisecond timing is
      // pure noise and would make the ratio meaningless).
      for (let i = 0; i < 3; i++) orderedChildren(root)
      const iterations = 20
      const started = performance.now()
      for (let i = 0; i < iterations; i++) expect(orderedChildren(root)).toHaveLength(n)
      return (performance.now() - started) / iterations
    }

    const small = project(500)
    const large = project(2000) // 4x the size
    expect(large / small).toBeLessThan(12)
  })
})
