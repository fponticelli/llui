// #239 — an isolated instance (`island`, and `lazy` on the server) as an `each`
// row's top-level node.
//
// The primitive returns a bare ANCHOR COMMENT and mounts its real body as the
// anchor's SIBLINGS, so the body is not in the node list the row reconciler moves.
// The comment itself is a perfectly stable node, which is why `each`'s existing
// `DocumentFragment` check cannot see it: before the marker in `row-root.ts` the
// client rendered happily and then corrupted on the FIRST reorder —
//
//   <!--each--><!--island--><!--island--><div class="leaf">L</div>… <!--/each-->
//
// — anchors migrated, mounted bodies did not. The server already threw on the same
// source (its island body is a multi-node fragment), so the two sides disagreed in
// the worst possible direction: a suite that never reorders stays green on the
// client and the page 500s in production.
//
// DECISION (#239 question 1): the client now REJECTS it too. That is enforcement of
// a rule the docs and CLAUDE.md already state — "a row must be one or more STABLE
// elements, never a bare structural primitive as the row root" — not a new rule; the
// measured blast radius across `packages/`, `registry/`, `examples/` and `site/` is
// ZERO production call sites (the only bare-island row in the tree is the negative
// fixture in `island-ssr.test.ts`).
import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { renderToString } from '../../src/signals/ssr'
import { component, div, each, lazy, li, text, ul } from '../../src/signals/authoring'
import type { Renderable } from '../../src/signals/element'
import { signalIsland as island } from '../../src/signals/island'
import { subApp } from '../../src/signals/escape-hatch'

interface LeafState {
  n: number
}
type LeafMsg = { type: 'noop' }

const Leaf = component<LeafState, LeafMsg>({
  name: 'Leaf',
  init: () => ({ n: 0 }),
  update: (s) => s,
  view: () => [div({ class: 'leaf' }, [text('L')])],
})

interface Row {
  id: string
}
type HostMsg = { type: 'reorder' }

/** A host whose single `each` renders each row with `render`. */
function host(render: () => Renderable) {
  return component<{ rows: Row[] }, HostMsg>({
    init: () => ({ rows: [{ id: 'a' }, { id: 'b' }] }),
    update: (s, m) => (m.type === 'reorder' ? { rows: [...s.rows].reverse() } : s),
    view: ({ state }) => [
      ul({ class: 'list' }, [each(state.at('rows'), { key: (r) => r.id, render })]),
    ],
  })
}

describe('#239 — an isolated instance is not a valid bare each row root', () => {
  it('REJECTS a bare `island()` row root on the CLIENT, matching the server', () => {
    const container = document.createElement('div')
    const Bare = host(() => [island<LeafState, LeafMsg>({ def: Leaf })])
    // It throws at MOUNT — immediately, on the first row built — rather than at the
    // first reorder, which is the whole point of the change.
    expect(() => mountSignalComponent(container, Bare)).toThrow(
      /cannot have an `island\(\)` or a `lazy\(\)`/,
    )
    expect(() => mountSignalComponent(container, Bare)).toThrow(
      /Wrap it in an element so the row has a stable boundary/,
    )
  })

  it('names the ANCHOR reason, not the fragment one — the author wrote no conditional', () => {
    const container = document.createElement('div')
    const Bare = host(() => [island<LeafState, LeafMsg>({ def: Leaf })])
    let message = ''
    try {
      mountSignalComponent(container, Bare)
    } catch (e) {
      message = (e as Error).message
    }
    // The old diagnostic said "wrap the conditional body in an element" and named
    // only `show`/`branch`/`each`, so an author who wrote no conditional went looking
    // for one that does not exist. The anchor branch must explain ITS mechanism…
    expect(message).toContain('mount their real body as its SIBLINGS')
    expect(message).toContain('migrates the anchor and leaves the mounted body behind')
    // …and must NOT claim a fragment, which is the other branch's reason.
    expect(message).not.toContain('DocumentFragment')
    // The fix is spelled out with the primitive the author actually used.
    expect(message).toContain('li([island({ def })])')
  })

  it('rejects an island that is merely ONE OF the row’s top-level nodes', () => {
    // Not only a "bare" root: the island's body sits outside the row's node list
    // however many siblings it has, so `[div(...), island(...)]` corrupts identically.
    const container = document.createElement('div')
    const Bare = host(() => [
      div({ class: 'label' }, [text('x')]),
      island<LeafState, LeafMsg>({ def: Leaf }),
    ])
    expect(() => mountSignalComponent(container, Bare)).toThrow(
      /cannot have an `island\(\)` or a `lazy\(\)`/,
    )
  })

  it('rejects the deprecated `subApp()` alias too — it is the same primitive', () => {
    const container = document.createElement('div')
    const Bare = host(() => [...subApp<LeafState, LeafMsg>({ reason: 'test', def: Leaf })])
    expect(() => mountSignalComponent(container, Bare)).toThrow(
      /cannot have an `island\(\)` or a `lazy\(\)`/,
    )
  })

  it('rejects a bare `lazy()` row root on the SERVER — island’s mirror image', () => {
    // `lazy` hits the two branches the other way round from `island`. On the CLIENT
    // it returns a FRAGMENT (anchor + fallback + end sentinel), which the `nodeType`
    // check has always caught; on the SERVER it returns the bare anchor, and only the
    // marker can see that. Without this case the server side of `lazy`'s marking is
    // uncovered — measured: removing `markUnstableRowRoot` from `lazy.ts` left every
    // other test in the package green.
    const BareServer = host(() => [
      lazy<LeafState, LeafMsg, never>({
        loader: () => Promise.resolve(Leaf),
        fallback: () => [text('…')],
      }),
    ])
    let serverMessage = ''
    try {
      renderToString(BareServer, undefined, document)
    } catch (e) {
      serverMessage = (e as Error).message
    }
    expect(serverMessage).toContain('cannot have an `island()` or a `lazy()`')
    // The SERVER takes the ANCHOR branch here, not the fragment one — the opposite of
    // `island`, whose server body IS a fragment (see `island-ssr.test.ts`). Read off
    // the captured message rather than `not.toThrow(/…/)`, which also passes when
    // nothing is thrown at all.
    expect(serverMessage).not.toContain('DocumentFragment')

    // The client half of the same source is rejected too, via the FRAGMENT branch —
    // and that branch must still name `lazy`. Naming only `show`/`branch`/`each` there
    // is #239's question-2 complaint one primitive over: an author who wrote a `lazy`
    // and no conditional reads a message about conditionals. Only the shared tail
    // would rescue them, which is exactly the misdirection the two branches exist to
    // remove, so it is asserted rather than left to the tail.
    const container = document.createElement('div')
    let clientMessage = ''
    try {
      mountSignalComponent(container, BareServer)
    } catch (e) {
      clientMessage = (e as Error).message
    }
    expect(clientMessage).toContain('DocumentFragment')
    expect(clientMessage).toContain('`lazy()` on the CLIENT')

    // And the wrap works on both sides.
    const Wrapped = host(() => [
      li({ class: 'row' }, [
        lazy<LeafState, LeafMsg, never>({
          loader: () => Promise.resolve(Leaf),
          fallback: () => [text('…')],
        }),
      ]),
    ])
    expect(renderToString(Wrapped, undefined, document)).toContain('<li class="row">')
    const fresh = document.createElement('div')
    const h = mountSignalComponent(fresh, Wrapped)
    expect(fresh.querySelectorAll('.row')).toHaveLength(2)
    h.dispose()
  })

  // ── The other direction ───────────────────────────────────────────
  // A guard is only worth having if the CORRECT form still works, and works across
  // the reorder that used to corrupt. This is the assertion the old client had no
  // way to make: it is the exact scenario #239 reports, with the wrap applied.

  it('the WRAPPED form mounts, and survives a reorder with bodies attached to rows', () => {
    const container = document.createElement('div')
    const Wrapped = host(() => [li({ class: 'row' }, [island<LeafState, LeafMsg>({ def: Leaf })])])
    const h = mountSignalComponent(container, Wrapped)

    const list = container.querySelector('.list')!
    const rowIds = (): string[] =>
      [...list.querySelectorAll('.row')].map((r) => (r.querySelector('.leaf') ? 'leaf' : 'EMPTY'))

    expect(list.querySelectorAll('.row')).toHaveLength(2)
    expect(rowIds()).toEqual(['leaf', 'leaf'])

    h.send({ type: 'reorder' })

    // Still two rows, each still owning its OWN mounted island body — the failure
    // mode #239 reports is exactly the loss of that pairing.
    expect(list.querySelectorAll('.row')).toHaveLength(2)
    expect(rowIds()).toEqual(['leaf', 'leaf'])
    // And no body escaped its row: every `.leaf` in the list is inside a `.row`.
    for (const leaf of list.querySelectorAll('.leaf')) {
      expect(leaf.closest('.row')).not.toBeNull()
    }
    h.dispose()
  })

  it('an island OUTSIDE an each row is untouched — the rule is about rows only', () => {
    const container = document.createElement('div')
    const Plain = component<{ n: number }, HostMsg>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      // A bare island at the top level of a view, and inside a plain element: both
      // are valid and must stay valid. Only `each` rows carry the constraint.
      view: () => [
        island<LeafState, LeafMsg>({ def: Leaf }),
        div({ class: 'box' }, [island<LeafState, LeafMsg>({ def: Leaf })]),
      ],
    })
    const h = mountSignalComponent(container, Plain)
    expect(container.querySelectorAll('.leaf')).toHaveLength(2)
    h.dispose()
  })
})
