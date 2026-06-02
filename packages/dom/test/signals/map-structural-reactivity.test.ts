import { describe, it, expect } from 'vitest'
import { component, mountApp, text, div, li, ul, each, show } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/index'
import { renderToString } from '../../src/signals/ssr'
import { hydrateSignalApp } from '../../src/signals/component'

// Regression: structural primitives (`show`, `each`) whose condition / items
// signal is a ROOT `.map()` derive — i.e. `state.map(s => …)`, dep path `''` —
// rather than a `.at('field')` path handle. A consumer is forced onto `.map()`
// when `.at()` would instantiate `ValidPath` over a deeply-recursive State type
// (TS2589). The mask must still fire: a `['']` (whole-state) dep is dirty on
// every reference change, so the structural arm must re-evaluate.
//
// Value bindings (text) over `state.map(…)` already react; this proves the
// structural ones do too.

describe('structural primitives over a root .map() derive (dep "")', () => {
  interface S {
    open: boolean
    items: { id: number; t: string }[]
    label: string
  }
  type M = { type: 'toggle' } | { type: 'add' } | { type: 'rename'; v: string }

  function setup() {
    const container = document.createElement('div')
    const h = mountApp<S, M>(
      container,
      component<S, M>({
        init: () => ({ open: false, items: [], label: 'x' }),
        update: (s, m) =>
          m.type === 'toggle'
            ? { ...s, open: !s.open }
            : m.type === 'add'
              ? {
                  ...s,
                  items: [...s.items, { id: s.items.length + 1, t: `t${s.items.length + 1}` }],
                }
              : { ...s, label: m.v },
        view: ({ state }) => [
          // text over root .map — known-good control
          div({ id: 'label' }, [text(state.map((s) => s.label))]),
          // show() gated on a root .map derive (dep '')
          show(
            state.map((s) => s.open),
            () => [div({ id: 'panel' }, [text('open')])],
          ),
          // each() over a root .map derive (dep '')
          ul({ id: 'list' }, [
            each(
              state.map((s) => s.items),
              { key: (i) => i.id, render: (item) => [li([text(item.at('t'))])] },
            ),
          ]),
        ],
      }),
    )
    return { h, container }
  }

  it('text over root .map reacts (control)', () => {
    const { h, container } = setup()
    expect(container.querySelector('#label')?.textContent).toBe('x')
    h.send({ type: 'rename', v: 'y' })
    expect(container.querySelector('#label')?.textContent).toBe('y')
  })

  it('show() over root .map reacts to its condition flipping', () => {
    const { h, container } = setup()
    expect(container.querySelector('#panel')).toBeNull()
    h.send({ type: 'toggle' })
    expect(container.querySelector('#panel')?.textContent).toBe('open')
    h.send({ type: 'toggle' })
    expect(container.querySelector('#panel')).toBeNull()
  })

  it('each() over root .map reacts when the list grows', () => {
    const { h, container } = setup()
    expect(container.querySelectorAll('#list li')).toHaveLength(0)
    h.send({ type: 'add' })
    expect([...container.querySelectorAll('#list li')].map((l) => l.textContent)).toEqual(['t1'])
    h.send({ type: 'add' })
    expect([...container.querySelectorAll('#list li')].map((l) => l.textContent)).toEqual([
      't1',
      't2',
    ])
  })
})

// The dicerun failure mode precisely: the structural blocks are built inside a
// HELPER function (not the direct view), the page is SSR-rendered with an EMPTY
// list / hidden panel, then HYDRATED, and only AFTER hydration does a message
// populate the list. If hydration of an initially-empty structural block fails
// to wire its reactive subscription, the post-hydrate state change is lost.
describe('helper-built structural primitives over root .map survive hydration', () => {
  interface S {
    open: boolean
    items: { id: number; t: string }[]
  }
  type M = { type: 'reveal' }

  // Structural blocks live in a HELPER — the case the compiler cannot lower, so
  // they run via the runtime authoring helpers during the (hydrate) build. The
  // helper takes a `Signal<S>` handle (the idiomatic sub-view composition shape)
  // and uses the real `.map()` / `.at()` API.
  const widget = (state: Signal<S>): Node =>
    div({ id: 'widget' }, [
      show(
        state.map((s) => s.open),
        () => [div({ id: 'panel' }, [text('open')])],
      ),
      ul({ id: 'list' }, [
        each(
          state.map((s) => s.items),
          {
            key: (i) => i.id,
            render: (item) => [li([text(item.at('t'))])],
          },
        ),
      ]),
    ])

  const def = component<S, M>({
    init: () => ({ open: false, items: [] }),
    update: (s, _m) => ({ ...s, open: true, items: [{ id: 1, t: 'a' }] }),
    view: ({ state }) => [widget(state)],
  })

  it('hydrates an empty each/show then reacts to a populating message', () => {
    const container = document.createElement('div')
    // Server render: empty list, hidden panel.
    container.innerHTML = renderToString(def, { open: false, items: [] }, document)
    expect(container.querySelector('#panel')).toBeNull()
    expect(container.querySelectorAll('#list li')).toHaveLength(0)

    // Hydrate against the same server state.
    const h = hydrateSignalApp(container, def, { open: false, items: [] })
    expect(container.querySelector('#panel')).toBeNull()
    expect(container.querySelectorAll('#list li')).toHaveLength(0)

    // A post-hydration message populates both the show and the each.
    h.send({ type: 'reveal' })
    expect(container.querySelector('#panel')?.textContent).toBe('open')
    expect([...container.querySelectorAll('#list li')].map((l) => l.textContent)).toEqual(['a'])
    h.dispose()
  })
})
