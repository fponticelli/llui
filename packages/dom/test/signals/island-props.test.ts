import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, each, text } from '../../src/signals/authoring'
import { derived } from '../../src/signals/handle'
import { signalIsland as island } from '../../src/signals/island'
import { subApp } from '../../src/signals/escape-hatch'

// `props` is a binding in the HOST's scope (the same shape `foreign`'s declared
// `state` inputs take), and `onProps` turns each value into a MESSAGE. Nothing pokes
// the island's state: its reducer stays the single writer, so a prop-driven change
// is indistinguishable from a user-driven one in the devtools log and to the agent
// protocol. It replaces the imperative `onHandle` + `handle.send` dance, and being a
// real binding is what makes it mask-gated and its deps visible to the analyzer.

interface PropState {
  value: string
  applied: number
}
type PropMsg = { type: 'setValue'; value: string }

const PropChild = component<PropState, PropMsg>({
  name: 'PropChild',
  init: () => ({ value: 'INIT', applied: 0 }),
  update: (s, m) => (m.type === 'setValue' ? { value: m.value, applied: s.applied + 1 } : s),
  view: ({ state }) => [
    div({ class: 'prop' }, [
      text(derived(state.at('value'), state.at('applied'), (v, n) => `${v}#${n}`)),
    ]),
  ],
})

interface TokenState {
  token: string
  unrelated: number
}
type TokenMsg = { type: 'setToken'; v: string } | { type: 'bump' }

const Host = component<TokenState, TokenMsg>({
  name: 'Host',
  init: () => ({ token: 'a', unrelated: 0 }),
  update: (s, m) =>
    m.type === 'setToken' ? { ...s, token: m.v } : { ...s, unrelated: s.unrelated + 1 },
  view: ({ state }) => [
    island({
      def: PropChild,
      props: state.at('token'),
      onProps: (value): PropMsg => ({ type: 'setValue', value }),
    }),
  ],
})

describe('island props/onProps', () => {
  it('delivers the initial value as a message right after mount', () => {
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host)
    // init() supplied 'INIT'; the first prop arrives immediately after mount, so the
    // applied count is 1 rather than 0 and the value is the host's, not the default.
    expect(container.querySelector('.prop')?.textContent).toBe('a#1')
    host.dispose()
  })

  it('dispatches the mapped message on every change', () => {
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host)
    host.send({ type: 'setToken', v: 'b' })
    expect(container.querySelector('.prop')?.textContent).toBe('b#2')
    host.send({ type: 'setToken', v: 'c' })
    expect(container.querySelector('.prop')?.textContent).toBe('c#3')
    host.dispose()
  })

  // The two NO-SEND tests below read the counter BEFORE and AFTER, rather than
  // asserting a literal. Every rendered string here carries the shared `applied`
  // counter, so a literal couples them to the delivery BASELINE: any mutation that
  // changes how many messages arrive at mount reddens them for a reason that has
  // nothing to do with the property they name, and inflates every kill count in the
  // mutation table. A before/after comparison measures "no message was sent" on its
  // own terms, whatever the baseline is.
  it('is mask-gated: a host change that misses the prop path sends nothing', () => {
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host)
    const before = container.querySelector('.prop')?.textContent
    host.send({ type: 'bump' })
    host.send({ type: 'bump' })
    // `applied` would climb if the binding re-committed on a state change it does
    // not read; the value half would be unchanged either way, so the counter is the
    // discriminating part.
    expect(container.querySelector('.prop')?.textContent).toBe(before)
    host.dispose()
  })

  it('does not re-send when the prop path is rewritten to an equal value', () => {
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Host)
    const before = container.querySelector('.prop')?.textContent
    host.send({ type: 'setToken', v: 'a' })
    expect(container.querySelector('.prop')?.textContent).toBe(before)
    host.dispose()
  })

  it('accepts a raw { produce, deps } spec (what a signal erases to)', () => {
    const container = document.createElement('div')
    const Raw = component<TokenState, TokenMsg>({
      init: () => ({ token: 'z', unrelated: 0 }),
      update: (s, m) => (m.type === 'setToken' ? { ...s, token: m.v } : s),
      view: () => [
        island({
          def: PropChild,
          props: { produce: (s) => (s as TokenState).token, deps: ['token'] },
          onProps: (value): PropMsg => ({ type: 'setValue', value }),
        }),
      ],
    })
    const host = mountSignalComponent(container, Raw)
    expect(container.querySelector('.prop')?.textContent).toBe('z#1')
    host.send({ type: 'setToken', v: 'y' })
    expect(container.querySelector('.prop')?.textContent).toBe('y#2')
    host.dispose()
  })

  it('feeds a ROW-local prop from inside an each row', () => {
    // Row locality comes from the handle's own brand (`componentRooted`), so a row
    // handle is NOT rebased to `ctx.state` and a component handle is — the same rule
    // `each` uses. Get it wrong and every row's island reads undefined.
    const container = document.createElement('div')
    const Rows = component<{ rows: Array<{ id: string; tag: string }> }, { type: 'noop' }>({
      init: () => ({
        rows: [
          { id: 'r1', tag: 'one' },
          { id: 'r2', tag: 'two' },
        ],
      }),
      update: (s) => s,
      view: ({ state }) => [
        each(state.at('rows'), {
          key: (r) => r.id,
          render: (row) => [
            div({ class: 'row' }, [
              island({
                def: PropChild,
                props: row.at('tag'),
                onProps: (value): PropMsg => ({ type: 'setValue', value }),
              }),
            ]),
          ],
        }),
      ],
    })
    const host = mountSignalComponent(container, Rows)
    const seen = [...container.querySelectorAll('.prop')].map((n) => n.textContent)
    expect(seen).toEqual(['one#1', 'two#1'])
    host.dispose()
  })

  it('feeds a COMPONENT-state prop named `item` / `state` from inside an each row', () => {
    // This is the case `componentRooted` exists for, and the ONLY one that
    // distinguishes it from the legacy dep-string inference. `isRowLocalDep` reads a
    // dep of `item`/`state`/`index` as row-local, so an UNBRANDED prop binding on a
    // component field literally named `item` is not rebased to `ctx.state` and its
    // produce reads `ctx.item` — the ROW OBJECT — rendering `[object Object]`.
    // Measured: deleting `componentRooted` from the spec turns both assertions below
    // into `[object Object]`, and reddens nothing else in the suite. The existing
    // row-local test covers only the direction the string inference gets right.
    const Rows = component<
      { rows: Array<{ id: string }>; item: string; state: string },
      { type: 'noop' }
    >({
      init: () => ({ rows: [{ id: 'r1' }], item: 'FIELD-ITEM', state: 'FIELD-STATE' }),
      update: (s) => s,
      view: ({ state }) => [
        each(state.at('rows'), {
          key: (r) => r.id,
          render: () => [
            div({ class: 'row' }, [
              island({
                def: PropChild,
                props: state.at('item'),
                onProps: (value): PropMsg => ({ type: 'setValue', value }),
              }),
              island({
                def: PropChild,
                props: state.at('state'),
                onProps: (value): PropMsg => ({ type: 'setValue', value }),
              }),
            ]),
          ],
        }),
      ],
    })
    const container = document.createElement('div')
    const host = mountSignalComponent(container, Rows)
    const seen = [...container.querySelectorAll('.prop')].map((n) => n.textContent)
    expect(seen).toEqual(['FIELD-ITEM#1', 'FIELD-STATE#1'])
    host.dispose()
  })

  it('rejects half a channel at build time, in both directions', () => {
    // Either half alone is a silently INERT channel — a prop with nowhere to go, or
    // a mapper nothing calls — so it is an authoring invariant, branded and thrown.
    const container = document.createElement('div')
    const OnlyProps = component<TokenState, TokenMsg>({
      init: () => ({ token: 'a', unrelated: 0 }),
      update: (s) => s,
      view: ({ state }) => [island({ def: PropChild, props: state.at('token') } as never)],
    })
    expect(() => mountSignalComponent(container, OnlyProps)).toThrow(/onProps/)

    const OnlyOnProps = component<TokenState, TokenMsg>({
      init: () => ({ token: 'a', unrelated: 0 }),
      update: (s) => s,
      view: () => [
        island({
          def: PropChild,
          onProps: (value: string): PropMsg => ({ type: 'setValue', value }),
        } as never),
      ],
    })
    expect(() => mountSignalComponent(container, OnlyOnProps)).toThrow(/props/)
  })
})

describe('the deprecated subApp alias', () => {
  it('is the same primitive, returning a spreadable Renderable', () => {
    const container = document.createElement('div')
    const Parent = component<{ n: number }, { type: 'noop' }>({
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [...subApp<PropState, PropMsg>({ reason: 'test: alias', def: PropChild })],
    })
    const parent = mountSignalComponent(container, Parent)
    expect(container.querySelector('.prop')?.textContent).toBe('INIT#0')
    parent.dispose()
    expect(container.querySelector('.prop')).toBeNull()
  })
})
