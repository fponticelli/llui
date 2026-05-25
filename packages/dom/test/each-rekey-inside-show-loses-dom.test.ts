/**
 * Reproduction for: dicerun2 bug report
 *   "each() add-after-remove loses the DOM mutation"
 *   /Users/franco/projects/dicerun2/docs/llui-issues/each-add-after-remove-loses-dom.md
 *
 * The bug arises from the documented "Pattern 4" composition: the parent
 * component constructs an `each()` at its view site (so the items accessor
 * pins the correct structural mask) and passes the returned Node[] to a
 * helper view (`rollerTabView`) which places the array inside a `show()`'s
 * arm:
 *
 *   // parent view ──
 *   rolledResultNodes: h.each({ items, key, render })
 *
 *   // helper view ──
 *   ...show({ when, render: () => [
 *     div({class: 'result-hero'}, [
 *       div({class: 'contents'}, opts.rolledResultNodes),  // ← captured
 *     ]),
 *   ] })
 *
 * Failure mode (reproduced by these tests):
 *   1. Initial items() returns [].  each() therefore returns just
 *      `[anchor, endAnchor]` — no entries between the boundary comments.
 *      Those two comments are captured in the Node[] passed to the helper.
 *   2. show.when is `false` at mount; the result-hero wrapper is never
 *      built.  The each's anchors are floating (no parent).
 *   3. show flips true: the helper's render builds the wrapper div and
 *      `appendChild`s the two boundary comments.  anchor.parentNode and
 *      endAnchor.parentNode are now the live wrapper.
 *   4. A reconcile happens (state changes, items() returns
 *      [{key: 'K1'}]).  each() takes Fast-path 2 (append-only); the new
 *      entry's nodes land between the anchors in the live wrapper.  ✓
 *   5. show flips false: the wrapper is detached; the each's anchors and
 *      entries go with it (still siblings in the detached subtree).
 *   6. Phase 1 visits the each block BEFORE the show block (the each was
 *      registered first — parent view ran before the helper's show()
 *      construction).  each.reconcile rekeys (items now [{key:'K2'}]).
 *      Fast-path 5 runs the rekey in the DETACHED wrapper (anchor still
 *      has a parent — the detached node).  ✓ from the each's POV.
 *   7. show.reconcile then flips back to true.  It runs the arm builder
 *      again, which builds a fresh wrapper div via
 *      `div('contents', opts.rolledResultNodes)`.  But
 *      `opts.rolledResultNodes` is the STALE `[anchor, endAnchor]` array
 *      captured at outer-view time — when items() was [].  appendChild
 *      moves anchor + endAnchor (only) into the new wrapper; the
 *      reconciled entry's nodes stay in the detached old wrapper.
 *   8. Visible result: the live wrapper's innerHTML is just
 *      `<!--each--><!--each-end-->`.  Reload-of-truth: state is fine,
 *      diff log fires `added: ['K2']`, but the DOM has no row.
 *
 * The bug is the framework's responsibility to handle: the user followed
 * the documented Pattern 4 and the each() lost track of where its
 * entries needed to live.
 */
import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type Row = { key: string; label: string }

type State = {
  rolling: boolean
  rows: Row[]
}

type Msg = { type: 'start-roll' } | { type: 'settle'; rows: Row[] }

/**
 * Mirrors the dicerun2 "Pattern 4" topology:
 *   - The outer view constructs `each()` and stashes the Node[] in a closure.
 *   - A nested call (here: the inline `helperView` block) places the Node[]
 *     inside a `show()` arm builder.
 *   - Initial items() returns [] (no rolls yet).
 *   - `start-roll` sets `rolling: true` so `show.when` flips false; the
 *     arm goes away.
 *   - `settle` provides new rows and sets `rolling: false` so `show.when`
 *     flips back true; the arm rebuilds.
 */
function makeDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Pattern4Each',
    init: () => [{ rolling: false, rows: [] }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'start-roll':
          return [{ ...state, rolling: true, rows: [] }, []]
        case 'settle':
          return [{ ...state, rolling: false, rows: msg.rows }, []]
      }
    },
    view: (h) => {
      // Pattern 4: each constructed at the outer site so items() pins the
      // correct structural mask — items reads `s.rows`. The returned
      // Node[] is captured in a const and threaded into the helper below.
      const eachNodes = each<State, Row>({
        items: (s) => s.rows,
        key: (r) => r.key,
        render: ({ item }) => [
          div({ class: 'row', 'data-key': item((r) => r.key) }, [text(item((r) => r.label))]),
        ],
      })

      // Helper view — captures `eachNodes` in a closure and uses it inside
      // a `show()` arm builder. Mirrors `rollerTabView`'s use of
      // `opts.rolledResultNodes`.
      const helperView = (): Node[] => [
        ...h.show({
          when: (s: State) => !s.rolling && s.rows.length > 0,
          render: () => [div({ class: 'result-hero' }, [div({ class: 'contents' }, eachNodes)])],
        }),
      ]

      return helperView()
    },
    __compilerVersion: '__test__',
    __prefixes: [(s) => s.rolling, (s) => s.rows],
  }
}

function getKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.row')).map((el) => el.getAttribute('data-key')!)
}

function getContentsHTML(container: HTMLElement): string {
  const contents = container.querySelector('.contents')
  return contents ? contents.innerHTML : ''
}

describe('each() inside show() with stale Node[] capture (Pattern 4)', () => {
  it('first roll renders the row', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // No rows initially, show.when=false (rolling=false, rows=0)
    expect(container.querySelector('.result-hero')).toBeNull()

    // First "roll" — start-roll then settle
    sendFn({ type: 'start-roll' })
    handle.flush()
    sendFn({ type: 'settle', rows: [{ key: 'K1', label: 'first' }] })
    handle.flush()

    expect(container.querySelector('.result-hero')).not.toBeNull()
    expect(getKeys(container)).toEqual(['K1'])
  })

  it('second roll renders the new row (the regression)', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn({ type: 'start-roll' })
    handle.flush()
    sendFn({ type: 'settle', rows: [{ key: 'K1', label: 'first' }] })
    handle.flush()
    expect(getKeys(container)).toEqual(['K1'])

    // Second roll — start-roll flips show.when=false; settle flips it
    // back true with a different-keyed row.
    sendFn({ type: 'start-roll' })
    handle.flush()
    sendFn({ type: 'settle', rows: [{ key: 'K2', label: 'second' }] })
    handle.flush()

    expect(
      getContentsHTML(container),
      `contents innerHTML after second roll: ${getContentsHTML(container)}`,
    ).not.toEqual('<!--each--><!--each-end-->')
    expect(getKeys(container)).toEqual(['K2'])
  })

  it('multiple rolls — every settle puts the new row in the DOM', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    for (let i = 1; i <= 5; i++) {
      sendFn({ type: 'start-roll' })
      handle.flush()
      sendFn({ type: 'settle', rows: [{ key: `K${i}`, label: `roll-${i}` }] })
      handle.flush()
      expect(getKeys(container), `after roll #${i}`).toEqual([`K${i}`])
    }
  })

  it('no binding errors surface during the roll sequence', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    for (let i = 1; i <= 3; i++) {
      sendFn({ type: 'start-roll' })
      handle.flush()
      sendFn({ type: 'settle', rows: [{ key: `K${i}`, label: `roll-${i}` }] })
      handle.flush()
    }

    const errors = errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(errors, `errors observed: ${JSON.stringify(errors)}`).toHaveLength(0)
  })
})
