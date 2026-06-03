import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text, each, show, branch } from '../../src/signals/authoring'
import type { Renderable } from '../../src/signals/dom'
import type { Signal } from '../../src/signals/types'

// Regression matrix for component-state reads inside STRUCTURAL primitives
// (show/branch/each) nested within an `each` row. A row scope mounts on the
// combined ctx `{ item, state, index }`; component-state handles must resolve
// against `ctx.state`, item/index against the row ctx — at EVERY depth, including
// inside show/branch ARMS (which are child-propagated the row ctx) and nested
// each rows. Reads must also stay REACTIVE to both component-state and item.

interface Item {
  id: number
  label: string
}
interface S {
  items: Item[]
  mode: 'a' | 'b'
  flagged: boolean
  tags: string[]
}
type M =
  | { type: 'flipMode' }
  | { type: 'toggleFlag' }
  | { type: 'relabel'; id: number; label: string }
  | { type: 'setTags'; tags: string[] }

const init = (): S => ({
  items: [
    { id: 1, label: 'one' },
    { id: 2, label: 'two' },
  ],
  mode: 'a',
  flagged: false,
  tags: ['x', 'y'],
})
const update = (s: S, m: M): S => {
  switch (m.type) {
    case 'flipMode':
      return { ...s, mode: s.mode === 'a' ? 'b' : 'a' }
    case 'toggleFlag':
      return { ...s, flagged: !s.flagged }
    case 'relabel':
      return { ...s, items: s.items.map((i) => (i.id === m.id ? { ...i, label: m.label } : i)) }
    case 'setTags':
      return { ...s, tags: m.tags }
  }
}

function mount(view: (state: Signal<S>) => Renderable) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => init(),
    update,
    view: ({ state }) => view(state),
  })
  return { h, txt: () => container.textContent ?? '', container }
}

// each row over items; `body` builds each row's content from the COMPONENT state
const rows =
  (body: (state: Signal<S>, item: Signal<Item>) => Renderable) =>
  (state: Signal<S>): Renderable => [
    each(
      state.map((s) => s.items),
      { key: (i) => i.id, render: (item) => [div([...body(state, item)])] },
    ),
  ]

describe('component-state reads inside structural primitives nested in an each row', () => {
  it('branch on component state inside a row, reactive to that state', () => {
    const { h, txt } = mount(
      rows((state) => [
        branch(
          state.map((s) => s.mode),
          { a: () => [text('A')], b: () => [text('B')] },
        ),
      ]),
    )
    expect(txt()).toBe('AA')
    h.send({ type: 'flipMode' })
    expect(txt()).toBe('BB') // ← was: crash reading row ctx
    h.dispose()
  })

  it('show on component state inside a row, reactive to that state', () => {
    const { h, txt } = mount(
      rows((state) => [
        show(
          state.map((s) => s.flagged),
          () => [text('F')],
        ),
      ]),
    )
    expect(txt()).toBe('')
    h.send({ type: 'toggleFlag' })
    expect(txt()).toBe('FF')
    h.dispose()
  })

  it('show ARM reads component state (content, not just the condition)', () => {
    const { h, txt } = mount(
      rows((state) => [
        show(
          state.map(() => true),
          () => [text(state.map((s) => s.mode))],
        ),
      ]),
    )
    expect(txt()).toBe('aa')
    h.send({ type: 'flipMode' })
    expect(txt()).toBe('bb')
    h.dispose()
  })

  it('show arm reads BOTH the row item and component state, both reactive', () => {
    const { h, txt } = mount(
      rows((state, item) => [
        show(
          state.map(() => true),
          () => [text(item.map((i) => i.label)), span([text(state.map((s) => s.mode))])],
        ),
      ]),
    )
    expect(txt()).toBe('oneatwoa')
    h.send({ type: 'flipMode' })
    expect(txt()).toBe('onebtwob')
    h.send({ type: 'relabel', id: 1, label: 'ONE' })
    expect(txt()).toBe('ONEbtwob')
    h.dispose()
  })

  it('branch nested inside a show arm inside a row (the grid/alternative-header shape)', () => {
    const { h, txt } = mount(
      rows((state) => [
        show(
          state.map(() => true),
          () => [
            branch(
              state.map((s) => s.mode),
              { a: () => [text('A')], b: () => [text('B')] },
            ),
          ],
        ),
      ]),
    )
    expect(txt()).toBe('AA')
    h.send({ type: 'flipMode' })
    expect(txt()).toBe('BB')
    h.dispose()
  })

  it('each nested inside a show arm inside a row (double structural nesting)', () => {
    const { h, txt } = mount(
      rows((state) => [
        show(
          state.map(() => true),
          () => [
            each(
              state.map((s) => s.tags),
              { key: (t) => t, render: (tag) => [span([text(tag)])] },
            ),
          ],
        ),
      ]),
    )
    // 2 rows, each lists tags x,y
    expect(txt()).toBe('xyxy')
    h.send({ type: 'setTags', tags: ['z'] })
    expect(txt()).toBe('zz')
    h.dispose()
  })

  it('each nested directly in an each row still works (regression)', () => {
    const { h, txt } = mount(
      rows((state) => [
        each(
          state.map((s) => s.tags),
          { key: (t) => t, render: (tag) => [span([text(tag)])] },
        ),
      ]),
    )
    expect(txt()).toBe('xyxy')
    h.send({ type: 'setTags', tags: ['q'] })
    expect(txt()).toBe('qq')
    h.dispose()
  })

  // A nested each whose ITEMS derive from the ROW ITEM (not component state):
  // `each(item.map(i => …), …)`. The nested each is `inRow`, so its structural
  // binding reconciles against the combined ctx — the items source must read the
  // row item (`ctx.item`), not be forced onto `ctx.state` (where `item` is
  // undefined → zero rows). This is the dicerun inline-roll shape: an outer
  // per-epoch each whose row renders an inner each over nodes derived from the
  // epoch row. Regressed silently — the row rendered empty with no error.
  it('each over a row-item-derived list (item.map) inside an each row renders + reacts', () => {
    const { h, txt } = mount(
      rows((_state, item) => [
        each(
          // derive a per-row list from the ITEM itself (label → one span per char)
          item.map((i) => i.label.split('')),
          { key: (ch) => ch, render: (ch) => [span([text(ch)])] },
        ),
      ]),
    )
    // 'one' → o,n,e  ;  'two' → t,w,o
    expect(txt()).toBe('onetwo')
    // relabeling a row re-derives that row's inner each
    h.send({ type: 'relabel', id: 1, label: 'ab' })
    expect(txt()).toBe('abtwo')
    h.dispose()
  })

  // When an outer arm whose content includes a NESTED structural primitive is
  // swapped/torn down, the inner primitive's dynamically-mounted content (a
  // sibling between its own anchors, not in the outer arm's built.nodes) must be
  // removed too — else it orphans in the DOM (the decisive.space edit-overlay bug).
  it('swapping an outer branch arm removes a nested branch arm content', () => {
    const { h, txt } = mount((state) => [
      branch(
        state.map((s) => (s.flagged ? 'edit' : 'route')),
        {
          route: () => [
            branch(
              state.map(() => 'opts'),
              { opts: () => [div([text('AddOption')])] },
            ),
          ],
          edit: () => [div([text('CreateOption')])],
        },
      ),
    ])
    expect(txt()).toBe('AddOption')
    h.send({ type: 'toggleFlag' }) // route -> edit
    expect(txt()).toBe('CreateOption') // ← was 'AddOptionCreateOption' (leak)
    h.send({ type: 'toggleFlag' }) // edit -> route, back to nested branch
    expect(txt()).toBe('AddOption')
    h.dispose()
  })

  it('swapping an outer show arm removes a nested show arm content', () => {
    const { h, txt } = mount((state) => [
      show(
        state.map((s) => !s.flagged),
        () => [
          show(
            state.map(() => true),
            () => [text('Inner')],
          ),
        ],
        () => [text('Else')],
      ),
    ])
    expect(txt()).toBe('Inner')
    h.send({ type: 'toggleFlag' })
    expect(txt()).toBe('Else') // nested 'Inner' must be gone
    h.dispose()
  })

  it('top-level show/branch (not in a row) still works (regression)', () => {
    const { h, txt } = mount((state) => [
      branch(
        state.map((s) => s.mode),
        { a: () => [text('A')], b: () => [text('B')] },
      ),
      show(
        state.map((s) => s.flagged),
        () => [text(state.map((s) => s.mode))],
      ),
    ])
    expect(txt()).toBe('A')
    h.send({ type: 'flipMode' })
    expect(txt()).toBe('B')
    h.send({ type: 'toggleFlag' })
    expect(txt()).toBe('Bb')
    h.dispose()
  })
})
