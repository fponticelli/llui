import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  ul,
  li,
  div,
  text,
  each,
  eachArm,
  eachDirect,
  show,
  component,
} from '../../src/signals/authoring'
import { el, signalText } from '../../src/signals/dom'
import type { RowFactory } from '../../src/signals/dom'

// The structural `each` binding must fire whenever anything its rows might read
// could have changed. The compiled pass-1 path merges collected row state-deps
// into the source deps; the AUTHORING path used only the items handle's deps —
// so a row-nested arm reading an unrelated state path was silently frozen out
// of state changes (stale DOM) whenever the items ref didn't change with it.
// These tests pin the fix (conservative whole-state `extraDeps` on the
// authoring tiers, precise `stateDeps` for compiled `eachDirect`) and the new
// `eachArm` mid-tier (compiled render arm over a verbatim items handle).

type Item = { id: number; label: string }
type S = { items: readonly Item[]; flag: boolean; mode: string }
type Msg = { type: 'flip' } | { type: 'mode'; v: string } | { type: 'unrelated' }

function makeApp(view: Parameters<typeof component<S, Msg, never>>[0]['view']) {
  return component<S, Msg, never>({
    name: 'fanout',
    init: () => [
      {
        items: [
          { id: 1, label: 'a' },
          { id: 2, label: 'b' },
        ],
        flag: false,
        mode: 'x',
      },
      [],
    ],
    update: (s, m) => {
      if (m.type === 'flip') return [{ ...s, flag: !s.flag }, []]
      if (m.type === 'mode') return [{ ...s, mode: m.v }, []]
      return [{ ...s }, []] // unrelated: new state ref, same fields
    },
    view,
  })
}

describe('authoring each — rows receive state-only updates', () => {
  it('a row-nested show on an unrelated state path updates when items ref is unchanged', () => {
    const App = makeApp(({ state }) => [
      ul({}, [
        each(state.at('items'), {
          key: (r) => r.id,
          render: (item) => [
            li({}, [
              text(item.at('label')),
              show(state.at('flag'), () => [div({ class: 'on' }, [text('ON')])]),
            ]),
          ],
        }),
      ]),
    ])
    const container = document.createElement('div')
    const h = mountSignalComponent(container, App)
    expect(container.querySelectorAll('.on').length).toBe(0)
    h.send({ type: 'flip' }) // items ref unchanged — rows must still see the change
    expect(container.querySelectorAll('.on').length).toBe(2)
    h.send({ type: 'flip' })
    expect(container.querySelectorAll('.on').length).toBe(0)
  })
})

describe('eachArm — compiled render arm over a verbatim items handle (mid-tier)', () => {
  it('mounts compiled bindings, updates on item change, and nested verbatim show reacts to state', () => {
    const App = makeApp(({ state, send }) => {
      void send
      return [
        ul({}, [
          // the compiled-arm shape the transform emits: el/signalText producers
          // read the combined row ctx; the nested VERBATIM show (the un-lowerable
          // structural child that motivates this tier) consumes a state handle.
          eachArm(
            state.at('items'),
            (r) => r.id,
            () => [
              el('li', { class: 'arow' }, [
                signalText((ctx) => (ctx as { item: Item }).item.label, ['item.label']),
                show(state.at('flag'), () => [div({ class: 'on' }, [text('ON')])]),
              ]),
            ],
          ),
        ]),
      ]
    })
    const container = document.createElement('div')
    const h = mountSignalComponent(container, App)
    const labels = (): string[] =>
      [...container.querySelectorAll('.arow')].map((e) => (e.firstChild as Text).data)
    expect(labels()).toEqual(['a', 'b'])
    expect(container.querySelectorAll('.on').length).toBe(0)

    // nested verbatim show reacts to a state-only change (items ref unchanged)
    h.send({ type: 'flip' })
    expect(container.querySelectorAll('.on').length).toBe(2)

    // unrelated state-ref change leaves output intact (output-equality holds)
    h.send({ type: 'unrelated' })
    expect(labels()).toEqual(['a', 'b'])
    expect(container.querySelectorAll('.on').length).toBe(2)
  })
})

describe('eachDirect — state deps for factory rows', () => {
  const factory: RowFactory = (doc, getCtx) => {
    const root = doc.createElement('li')
    root.className = 'frow'
    const t = doc.createTextNode('')
    root.appendChild(t)
    return {
      nodes: [root],
      bindings: [
        {
          deps: ['item.label', 'state.mode'],
          produce: (ctx) => {
            const c = ctx as { item: Item; state: S }
            return `${c.item.label}:${c.state.mode}`
          },
          commit: (v) => {
            t.data = String(v)
          },
        },
      ],
    }
  }

  it('legacy 3-arg eachDirect (no stateDeps) still sees state-only changes (conservative)', () => {
    const App = makeApp(({ state }) => [
      ul({}, [eachDirect(state.at('items'), (r) => r.id, factory)]),
    ])
    const container = document.createElement('div')
    const h = mountSignalComponent(container, App)
    expect(container.querySelector('.frow')!.textContent).toBe('a:x')
    h.send({ type: 'mode', v: 'y' }) // items ref unchanged
    expect(container.querySelector('.frow')!.textContent).toBe('a:y')
  })

  it('4-arg eachDirect with precise stateDeps updates on those paths', () => {
    const App = makeApp(({ state }) => [
      ul({}, [eachDirect(state.at('items'), (r) => r.id, factory, ['mode'])]),
    ])
    const container = document.createElement('div')
    const h = mountSignalComponent(container, App)
    expect(container.querySelector('.frow')!.textContent).toBe('a:x')
    h.send({ type: 'mode', v: 'z' })
    expect(container.querySelector('.frow')!.textContent).toBe('a:z')
  })
})
