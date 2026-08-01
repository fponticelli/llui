import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  staticText,
  el,
  react,
  signalShow,
  signalEach,
  signalBranch,
} from '../../src/signals/dom'
import { derived } from '../../src/signals/handle'
import { compileAndLoad, identityComponent } from './compile-and-load'
import {
  div,
  span,
  ul,
  li,
  text,
  each,
  show,
  branch,
  virtualEach,
} from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// Regression suite for issue #52 — a structural primitive (`show`/`branch`/a nested
// `each`) inside an `each` row stopped swapping arms after an ODD number of row
// updates that did not commit its binding.
//
// Root cause: `each` RECYCLES two ctx buffers per row and rotates them on every
// row update, while a structural spec's `produce` is the identity function (the
// reconcile needs the whole state to mount the arm against). The scope's
// output-equality check therefore compared BUFFER IDENTITY, and `last[i]` only
// advanced on commit — so one gated-out row update desynchronised the rotation
// from `last[i]` and every later `produce()` returned the very object already
// sitting there, suppressing the commit regardless of the discriminant.
//
// Fix: output-equality is a VALUE-binding optimization; a structural spec is
// exempt (it is gated by its deps and self-deduplicates inside its reconcile).

describe('structural primitive inside an each row — arm swaps at every parity', () => {
  interface Row {
    id: string
    mode: 'a' | 'b'
    label: string
  }
  interface S {
    rows: readonly Row[]
  }
  type M = { type: 'set'; rows: readonly Row[] }

  const mount = (view: (state: Signal<S>) => ReturnType<typeof div>[]) => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, M>(c, {
      init: () => ({ rows: [{ id: 'r1', mode: 'a', label: 'one' }] }),
      update: (_s, m) => ({ rows: m.rows }),
      view: ({ state }) => view(state),
    })
    return { c, h }
  }

  const branchView = (state: Signal<S>) => [
    div({}, [
      each(state.at('rows'), {
        key: (r) => r.id,
        render: (row: Signal<Row>) => [
          div({ class: 'row' }, [
            // A plain value binding on the SAME signal, for contrast: it produces a
            // VALUE, so it was never affected.
            span({ class: 'mode-text' }, [text(row.at('mode'))]),
            branch(row.at('mode'), {
              a: () => [span({ class: 'arm-a' }, [text('A')])],
              b: () => [span({ class: 'arm-b' }, [text('B')])],
            }),
          ]),
        ],
      }),
    ]),
  ]

  // `show` with a PRECISE dep (`item.mode`) — the spelling the issue reports as
  // broken; a coarse `row.map(r => …)` (dep `item`) merely hid it in some cases.
  const showView = (state: Signal<S>) => [
    div({}, [
      each(state.at('rows'), {
        key: (r) => r.id,
        render: (row: Signal<Row>) => [
          div({ class: 'row' }, [
            span({ class: 'mode-text' }, [text(row.at('mode'))]),
            show(
              row.at('mode').map((m) => m === 'b'),
              () => [span({ class: 'arm-b' }, [text('B')])],
              () => [span({ class: 'arm-a' }, [text('A')])],
            ),
          ]),
        ],
      }),
    ]),
  ]

  const arm = (c: Element) =>
    c.querySelector('.arm-b') ? 'b' : c.querySelector('.arm-a') ? 'a' : ''
  const modeText = (c: Element) => c.querySelector('.mode-text')!.textContent

  for (const [name, view] of [
    ['branch', branchView],
    ['show', showView],
  ] as const) {
    describe(name, () => {
      // The table from the issue: N intervening row updates that do NOT commit the
      // structural binding (only `label` changes, so its `item.mode` dep is clean).
      // Every N must swap — parity 1 was the reported failure.
      for (const noops of [0, 1, 2, 3]) {
        it(`swaps after ${noops} non-committing row update(s)`, () => {
          const { c, h } = mount(view)
          expect(arm(c)).toBe('a')

          for (let i = 0; i < noops; i++) {
            h.send({ type: 'set', rows: [{ id: 'r1', mode: 'a', label: `l${i}` }] })
            expect(arm(c)).toBe('a') // still the same arm — nothing to swap yet
          }

          h.send({ type: 'set', rows: [{ id: 'r1', mode: 'b', label: 'flipped' }] })
          expect(modeText(c)).toBe('b')
          expect(arm(c)).toBe('b')

          // ...and back again, from whatever parity we are now at.
          h.send({ type: 'set', rows: [{ id: 'r1', mode: 'a', label: 'flipped' }] })
          expect(modeText(c)).toBe('a')
          expect(arm(c)).toBe('a')
        })
      }

      it('swaps on every flip across a long alternating run', () => {
        const { c, h } = mount(view)
        for (let i = 0; i < 8; i++) {
          const mode = i % 2 === 0 ? 'b' : 'a'
          // A label-only update between every flip keeps the parity drifting.
          h.send({
            type: 'set',
            rows: [{ id: 'r1', mode: i % 2 === 0 ? 'a' : 'b', label: `x${i}` }],
          })
          h.send({ type: 'set', rows: [{ id: 'r1', mode, label: `x${i}` }] })
          expect(arm(c)).toBe(mode)
        }
      })
    })
  }

  it('does NOT remount the arm on a same-key update (no over-committing)', () => {
    const { c, h } = mount(branchView)
    const armNode = c.querySelector('.arm-a')
    expect(armNode).not.toBeNull()
    // Several label-only updates: the discriminant is unchanged, so the mounted
    // arm must be the very same node (ArmController short-circuits on same key).
    for (let i = 0; i < 4; i++) {
      h.send({ type: 'set', rows: [{ id: 'r1', mode: 'a', label: `l${i}` }] })
      expect(c.querySelector('.arm-a')).toBe(armNode)
    }
    h.send({ type: 'set', rows: [{ id: 'r1', mode: 'b', label: 'z' }] })
    expect(c.querySelector('.arm-a')).toBeNull()
    expect(c.querySelector('.arm-b')).not.toBeNull()
  })

  it('holds for several rows flipping independently', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, M>(c, {
      init: () => ({
        rows: [
          { id: 'r1', mode: 'a', label: 'one' },
          { id: 'r2', mode: 'a', label: 'two' },
          { id: 'r3', mode: 'b', label: 'three' },
        ],
      }),
      update: (_s, m) => ({ rows: m.rows }),
      view: ({ state }) => branchView(state),
    })
    const arms = () =>
      Array.from(c.querySelectorAll('.row')).map((r) => (r.querySelector('.arm-b') ? 'b' : 'a'))
    expect(arms()).toEqual(['a', 'a', 'b'])

    // Parity-breaking, label-only update on every row.
    h.send({
      type: 'set',
      rows: [
        { id: 'r1', mode: 'a', label: '1' },
        { id: 'r2', mode: 'a', label: '2' },
        { id: 'r3', mode: 'b', label: '3' },
      ],
    })
    expect(arms()).toEqual(['a', 'a', 'b'])

    h.send({
      type: 'set',
      rows: [
        { id: 'r1', mode: 'b', label: '1' },
        { id: 'r2', mode: 'a', label: '2' },
        { id: 'r3', mode: 'a', label: '3' },
      ],
    })
    expect(arms()).toEqual(['b', 'a', 'a'])
  })
})

// A nested `each` pushes the same identity-produce structural spec, so it sits in
// the same hazard class. The AUTHORING tier happens to escape it because its rows'
// state reads are unknowable, so it declares whole-state deps (`WHOLE_STATE_DEPS`)
// and therefore commits on every component-state change — never accumulating the
// gated-out update that breaks the parity. That immunity is incidental (a compiled
// tier passes precise `stateDeps`), so pin the behaviour here.
describe('nested each inside an each row — reconciles at every parity', () => {
  interface Row {
    id: string
    tags: readonly string[]
    label: string
  }
  interface S {
    rows: readonly Row[]
  }
  type M = { type: 'set'; rows: readonly Row[] }

  // ONE array instance, shared by the initial state and the parity-breaking update
  // below: the nested each's `item.tags` dep must stay ref-clean across that update
  // (a fresh `['x']` would dirty it and commit, hiding the defect).
  const TAGS: readonly string[] = ['x']

  const make = () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, M>(c, {
      init: () => ({ rows: [{ id: 'r1', tags: TAGS, label: 'one' }] }),
      update: (_s, m) => ({ rows: m.rows }),
      view: ({ state }) => [
        ul({}, [
          each(state.at('rows'), {
            key: (r) => r.id,
            render: (row: Signal<Row>) => [
              li({ class: 'row' }, [
                span({ class: 'label' }, [text(row.at('label'))]),
                ul({ class: 'tags' }, [
                  each(row.at('tags'), {
                    key: (t) => t,
                    render: (tag: Signal<string>) => [li({ class: 'tag' }, [text(tag)])],
                  }),
                ]),
              ]),
            ],
          }),
        ]),
      ],
    })
    return { c, h }
  }

  it('adds a nested row after a parity-breaking label-only update', () => {
    const { c, h } = make()
    const tags = () => Array.from(c.querySelectorAll('.tag')).map((n) => n.textContent)
    expect(tags()).toEqual(['x'])

    // Parity break: `tags` ref is unchanged, so the nested each's binding is gated
    // out while the row's ctx buffers still rotate.
    h.send({ type: 'set', rows: [{ id: 'r1', tags: TAGS, label: 'two' }] })
    expect(tags()).toEqual(['x'])

    h.send({ type: 'set', rows: [{ id: 'r1', tags: ['x', 'y'], label: 'two' }] })
    expect(tags()).toEqual(['x', 'y'])
  })
})

// The COMPILED tier emits its own precise deps for a nested structural condition,
// so the gate-out that breaks the parity is if anything easier to hit there.
describe('compiled: branch inside an each row swaps at every parity', () => {
  interface CompiledRow {
    id: string
    mode: 'a' | 'b'
    label: string
  }
  interface CompiledS {
    rows: readonly CompiledRow[]
  }
  type CompiledM = { type: 'set'; rows: readonly CompiledRow[] }

  const SRC = `
    import { component } from '@llui/dom'
    import { text, div, span, each, branch } from '@llui/dom'
    export const App = component({
      init: () => [{ rows: [{ id: 'r1', mode: 'a', label: 'one' }] }, []],
      update: (s, m) => (m.type === 'set' ? [{ rows: m.rows }, []] : [s, []]),
      view: ({ state }) => [
        div({}, [
          each(state.at('rows'), {
            key: (r) => r.id,
            render: (row) => [
              div({ class: 'row' }, [
                span({ class: 'mode-text' }, [text(row.at('mode'))]),
                branch(row.at('mode'), {
                  a: () => [span({ class: 'arm-a' }, [text('A')])],
                  b: () => [span({ class: 'arm-b' }, [text('B')])],
                }),
              ]),
            ],
          }),
        ]),
      ],
    })
  `

  const RUNTIME = {
    signalText,
    staticText,
    el,
    react,
    signalShow,
    signalEach,
    signalBranch,
    derived,
    component: identityComponent,
  }

  it('swaps after a parity-breaking label-only update', () => {
    const App = compileAndLoad<CompiledS, CompiledM>(SRC, 'App', RUNTIME)
    const c = document.createElement('div')
    const h = mountSignalComponent(c, App)
    expect(c.querySelector('.arm-a')).not.toBeNull()

    h.send({ type: 'set', rows: [{ id: 'r1', mode: 'a', label: 'two' }] })
    expect(c.querySelector('.arm-a')).not.toBeNull()

    h.send({ type: 'set', rows: [{ id: 'r1', mode: 'b', label: 'two' }] })
    expect(c.querySelector('.mode-text')?.textContent).toBe('b')
    expect(c.querySelector('.arm-b')).not.toBeNull()
    expect(c.querySelector('.arm-a')).toBeNull()
  })
})

// `virtualEach` recycles and rotates its row ctx buffers exactly like `each`
// (`virtual-each.ts` — lazy `spare`, swapped on every row update), so a structural
// primitive in a windowed row sat in the same trap.
describe('branch inside a virtualEach row — swaps at every parity', () => {
  interface Item {
    id: number
    mode: 'a' | 'b'
    label: string
  }
  interface S {
    items: Item[]
  }
  type M = { type: 'set'; items: Item[] }

  const make = () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, M>(c, {
      init: () => ({ items: [{ id: 0, mode: 'a', label: 'one' }] }),
      update: (_s, m) => ({ items: m.items }),
      view: ({ state }) => [
        virtualEach<Item>({
          items: state.at('items'),
          key: (it) => it.id,
          itemHeight: 20,
          containerHeight: 100,
          class: 'vlist',
          render: (item) => [
            div({ class: 'row' }, [
              span({ class: 'mode-text' }, [text(item.at('mode'))]),
              branch(item.at('mode'), {
                a: () => [span({ class: 'arm-a' }, [text('A')])],
                b: () => [span({ class: 'arm-b' }, [text('B')])],
              }),
            ]),
          ],
        }),
      ],
    })
    return { c, h }
  }

  it('swaps after a parity-breaking label-only update', () => {
    const { c, h } = make()
    expect(c.querySelector('.arm-a')).not.toBeNull()

    h.send({ type: 'set', items: [{ id: 0, mode: 'a', label: 'two' }] })
    expect(c.querySelector('.arm-a')).not.toBeNull()

    h.send({ type: 'set', items: [{ id: 0, mode: 'b', label: 'two' }] })
    expect(c.querySelector('.mode-text')?.textContent).toBe('b')
    expect(c.querySelector('.arm-b')).not.toBeNull()
    expect(c.querySelector('.arm-a')).toBeNull()
  })
})
