import { describe, it, expect } from 'vitest'
import { component, div, article, text, mountApp } from '../src/index'
import type { View } from '../src/view-helpers'

// Regression test for the "branch arm swap leaks nested structural DOM"
// bug. When the outer branch swaps arms, every descendant of the
// leaving arm — including nodes inserted by nested branch / show /
// each primitives — must be removed from the DOM and their lifetimes
// disposed.
//
// Reproduces an issue filed against @llui/dom@0.0.27 where navigating
// between routes (outer branch cases) left behind `.inner-a` /
// `.inner-b` elements from the previous route's nested branch.

type S = { route: 'grid' | 'docs'; mode: 'a' | 'b' }
type M = { type: 'setRoute'; v: 'grid' | 'docs' } | { type: 'setMode'; v: 'a' | 'b' }

function def() {
  const innerBranch = (h: View<S, M>) =>
    h.branch({
      on: (s) => s.mode,
      cases: {
        a: () => [div({ class: 'inner-a' }, [text('A')])],
        b: () => [div({ class: 'inner-b' }, [text('B')])],
      },
    })

  return component<S, M, never>({
    name: 'Shell',
    init: () => [{ route: 'grid', mode: 'a' }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setRoute':
          return [{ ...state, route: msg.v }, []]
        case 'setMode':
          return [{ ...state, mode: msg.v }, []]
      }
    },
    view: (h) => [
      div({ class: 'shell' }, [
        ...h.branch({
          on: (s) => s.route,
          cases: {
            grid: (h2) => [div({ class: 'grid' }, innerBranch(h2))],
            docs: () => [article({ class: 'doc' }, [text('Docs')])],
          },
        }),
      ]),
    ],
    __dirty: (o, n) =>
      (Object.is(o.route, n.route) ? 0 : 0b01) | (Object.is(o.mode, n.mode) ? 0 : 0b10),
  })
}

describe('branch — arm swap disposes nested structural DOM', () => {
  it('nested branch in a grid arm is fully removed when the outer branch swaps to docs', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, def())
    try {
      // Initial state: route=grid, mode=a. The grid arm contains a
      // nested branch whose active case renders .inner-a.
      expect(container.querySelector('.grid')).not.toBeNull()
      expect(container.querySelector('.inner-a')).not.toBeNull()
      expect(container.querySelector('.inner-b')).toBeNull()
      expect(container.querySelector('.doc')).toBeNull()

      handle.send({ type: 'setRoute', v: 'docs' })
      handle.flush()

      // After the outer branch swaps to docs, the grid arm and its
      // nested branch's .inner-a must both be gone. The bug this test
      // pins: previously .grid and .inner-a stayed in the DOM
      // alongside the new .doc.
      expect(container.querySelector('.doc')).not.toBeNull()
      expect(container.querySelector('.grid')).toBeNull()
      expect(container.querySelector('.inner-a')).toBeNull()
      expect(container.querySelector('.inner-b')).toBeNull()
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('swapping back to the grid arm rebuilds the nested branch fresh (no stale nodes)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, def())
    try {
      // grid → docs → grid round-trip.
      handle.send({ type: 'setRoute', v: 'docs' })
      handle.flush()
      handle.send({ type: 'setRoute', v: 'grid' })
      handle.flush()

      // Exactly one .grid and one .inner-a, both freshly built.
      expect(container.querySelectorAll('.grid').length).toBe(1)
      expect(container.querySelectorAll('.inner-a').length).toBe(1)
      expect(container.querySelectorAll('.doc').length).toBe(0)
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('outer arm swap after a nested-branch mode flip removes all leftover DOM', () => {
    // Tightens the base test: after the inner branch has reconciled
    // to a different case, the outer arm's currentNodes snapshot
    // doesn't include the new inner DOM. The outer arm swap must
    // still remove every leaf the current render actually produced —
    // not just what the outer arm captured at initial render time.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, def())
    try {
      // Flip inner case first (mode: a → b) so the live DOM diverges
      // from outer's captured currentNodes.
      handle.send({ type: 'setMode', v: 'b' })
      handle.flush()
      expect(container.querySelector('.inner-b')).not.toBeNull()
      expect(container.querySelector('.inner-a')).toBeNull()

      // Now swap outer arm. Before the fix, .inner-b would leak
      // because outer's leavingNodes still pointed at the stale
      // .inner-a which was already detached; .inner-b (sibling,
      // live in DOM) had no one removing it.
      handle.send({ type: 'setRoute', v: 'docs' })
      handle.flush()

      expect(container.querySelector('.doc')).not.toBeNull()
      expect(container.querySelector('.grid')).toBeNull()
      expect(container.querySelector('.inner-a')).toBeNull()
      expect(container.querySelector('.inner-b')).toBeNull()
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('inner branch reconcile fires independently after a grid→grid mode change', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, def())
    try {
      expect(container.querySelector('.inner-a')).not.toBeNull()
      // Change the nested branch's discriminant without swapping the
      // outer arm. Only the inner branch should reconcile.
      handle.send({ type: 'setMode', v: 'b' })
      handle.flush()

      expect(container.querySelector('.inner-a')).toBeNull()
      expect(container.querySelector('.inner-b')).not.toBeNull()
      expect(container.querySelector('.grid')).not.toBeNull()
    } finally {
      handle.dispose()
      container.remove()
    }
  })
})

// Extra coverage: nested primitives spread DIRECTLY into the arm's
// returned node list (instead of wrapped in a container element) are
// a pattern the user might hit. When the outer arm returns the
// nested primitive's anchor + children as siblings of the outer
// arm's own top-level nodes, outer's `currentNodes` tracking picks
// them up at initial build time — but if the inner primitive
// reconciles BEFORE the outer swaps, outer's leavingNodes is stale
// and the new inner DOM leaks.
describe('branch — nested primitives spread into outer arm (no wrapper)', () => {
  type S = { route: 'list' | 'detail'; items: string[] }
  type M = { type: 'setRoute'; v: 'list' | 'detail' } | { type: 'setItems'; v: string[] }

  const makeDef = () =>
    component<S, M, never>({
      name: 'SpreadShell',
      init: () => [{ route: 'list', items: ['x', 'y'] }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setRoute':
            return [{ ...state, route: msg.v }, []]
          case 'setItems':
            return [{ ...state, items: msg.v }, []]
        }
      },
      view: (h) => [
        div({ class: 'shell' }, [
          ...h.branch({
            on: (s) => s.route,
            cases: {
              list: (h2) => [
                div({ class: 'header' }, [text('Header')]),
                ...h2.each({
                  items: (s: S) => s.items,
                  key: (x) => x,
                  render: () => [div({ class: 'row' }, [text('·')])],
                }),
              ],
              detail: () => [article({ class: 'detail' }, [text('Detail')])],
            },
          }),
        ]),
      ],
      __dirty: (o, n) =>
        (Object.is(o.route, n.route) ? 0 : 0b01) | (Object.is(o.items, n.items) ? 0 : 0b10),
    })

  it('each rows spread into the list arm are fully removed when outer arm swaps to detail', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeDef())
    try {
      expect(container.querySelectorAll('.row').length).toBe(2)
      expect(container.querySelector('.header')).not.toBeNull()

      handle.send({ type: 'setRoute', v: 'detail' })
      handle.flush()

      expect(container.querySelector('.detail')).not.toBeNull()
      // All nested-primitive-inserted DOM must be gone.
      expect(container.querySelectorAll('.row').length).toBe(0)
      expect(container.querySelector('.header')).toBeNull()
    } finally {
      handle.dispose()
      container.remove()
    }
  })

  it('each rows added AFTER initial render are also removed when outer arm swaps', () => {
    // Reproduces the stale-currentNodes scenario: each() reconciles
    // before the outer branch swap, so the NEW rows aren't in the
    // outer's leavingNodes captured at initial build.
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountApp(container, makeDef())
    try {
      // Add two more items — each() reconciles, inserts fresh rows.
      handle.send({ type: 'setItems', v: ['x', 'y', 'z', 'w'] })
      handle.flush()
      expect(container.querySelectorAll('.row').length).toBe(4)

      // Now swap outer arm. Before any fix, the NEW rows (z, w)
      // might leak because outer's leavingNodes was captured before
      // they existed.
      handle.send({ type: 'setRoute', v: 'detail' })
      handle.flush()

      expect(container.querySelector('.detail')).not.toBeNull()
      expect(container.querySelectorAll('.row').length).toBe(0)
    } finally {
      handle.dispose()
      container.remove()
    }
  })
})
