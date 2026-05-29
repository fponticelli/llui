import { describe, it, expect } from 'vitest'
import {
  component,
  mountApp,
  text,
  span,
  div,
  ul,
  li,
  button,
  each,
  show,
} from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// These components are NOT run through the compiler — they exercise the RUNTIME
// authoring helpers (text/elements/each/show consuming runtime signal handles).
// This proves view-helper composition works without the transform: a factored
// helper (`chip`) builds reactive DOM from a Signal param.

describe('view-helper composition (runtime signals)', () => {
  interface Item {
    id: number
    t: string
  }
  interface S {
    name: string
    items: Item[]
    open: boolean
  }
  type M = { type: 'rename'; v: string } | { type: 'add' } | { type: 'toggle' }

  // a view HELPER function receiving a Signal — the case the compile-time
  // transform can't lower, now works at runtime.
  const chip = (label: Signal<string>): Node => span([text(label)])

  function setup() {
    const container = document.createElement('div')
    const h = mountApp<S, M>(
      container,
      component<S, M>({
        init: () => ({ name: 'ada', items: [{ id: 1, t: 'a' }], open: false }),
        update: (s, m) =>
          m.type === 'rename'
            ? { ...s, name: m.v }
            : m.type === 'add'
              ? { ...s, items: [...s.items, { id: s.items.length + 1, t: 'x' }] }
              : { ...s, open: !s.open },
        view: ({ state, send }) => [
          div({ id: 'chip' }, [chip(state.at('name'))]),
          ul({ id: 'list' }, [
            each(state.at('items'), {
              key: (i) => i.id,
              render: (item) => [li([text(item.at('t'))])],
            }),
          ]),
          show(state.at('open'), () => [div({ id: 'panel' }, [text('open')])]),
          button(
            { id: 'b', onClick: () => send({ type: 'rename', v: state.at('name').peek() + '!' }) },
            [text('go')],
          ),
        ],
      }),
    )
    return { h, container }
  }

  it('helpers build reactive DOM and react to state (no compiledAway throwers)', () => {
    const { h, container } = setup()
    expect(container.querySelector('#chip')?.textContent).toBe('ada')
    expect([...container.querySelectorAll('#list li')].map((l) => l.textContent)).toEqual(['a'])
    expect(container.querySelector('#panel')).toBeNull()

    // chip() helper's text is reactive
    h.send({ type: 'rename', v: 'lin' })
    expect(container.querySelector('#chip')?.textContent).toBe('lin')

    // each row item handle is reactive (new row appended)
    h.send({ type: 'add' })
    expect([...container.querySelectorAll('#list li')].map((l) => l.textContent)).toEqual([
      'a',
      'x',
    ])

    // show arm mounts/unmounts
    h.send({ type: 'toggle' })
    expect(container.querySelector('#panel')?.textContent).toBe('open')
    h.send({ type: 'toggle' })
    expect(container.querySelector('#panel')).toBeNull()
  })

  it('handler reads current state via .peek()', () => {
    const { container } = setup()
    const btn = container.querySelector('#b') as HTMLButtonElement
    btn.dispatchEvent(new Event('click'))
    expect(container.querySelector('#chip')?.textContent).toBe('ada!')
  })
})
