import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, react } from '../../src/signals/dom'

describe('mountSignalComponent — TEA loop over signals', () => {
  it('runs a counter end-to-end: send -> update -> reactive DOM', () => {
    interface S {
      count: number
    }
    type M = { type: 'inc' } | { type: 'dec' }

    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ count: 0 }),
      update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : { count: s.count - 1 }),
      view: (send) => [
        el('button', { onClick: () => send({ type: 'dec' }) }, []),
        el('span', {}, [signalText((s) => (s as S).count, ['count'])]),
        el('button', { onClick: () => send({ type: 'inc' }) }, []),
      ],
    })

    expect(container.querySelector('span')!.textContent).toBe('0')
    h.send({ type: 'inc' })
    h.send({ type: 'inc' })
    expect(container.querySelector('span')!.textContent).toBe('2')
    expect(h.getState().count).toBe(2)
    h.send({ type: 'dec' })
    expect(container.querySelector('span')!.textContent).toBe('1')
  })

  it('only the affected binding updates (gating across a real update)', () => {
    interface S {
      count: number
      name: string
    }
    type M = { type: 'inc' } | { type: 'rename'; v: string }

    const container = document.createElement('div')
    let nameNode!: Text
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ count: 0, name: 'ada' }),
      update: (s, m) => (m.type === 'inc' ? { ...s, count: s.count + 1 } : { ...s, name: m.v }),
      view: () => {
        nameNode = signalText((s) => (s as S).name, ['name'])
        return [
          el('span', {}, [signalText((s) => (s as S).count, ['count'])]),
          el('p', {}, [nameNode]),
        ]
      },
    })

    const nameBefore = nameNode
    h.send({ type: 'inc' }) // changes count, not name
    expect(container.querySelector('span')!.textContent).toBe('1')
    expect(nameNode).toBe(nameBefore) // same node, untouched
    expect(nameNode.data).toBe('ada')

    h.send({ type: 'rename', v: 'lin' })
    expect(nameNode.data).toBe('lin')
    expect(nameNode).toBe(nameBefore) // still in place
  })

  it('a reactive attribute driven by the loop', () => {
    interface S {
      busy: boolean
    }
    type M = { type: 'toggle' }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ busy: false }),
      update: (s) => ({ busy: !s.busy }),
      view: () => [
        el('div', { class: react((s) => ((s as S).busy ? 'spin' : 'idle'), ['busy']) }, []),
      ],
    })
    const div = container.querySelector('div')!
    expect(div.getAttribute('class')).toBe('idle')
    h.send({ type: 'toggle' })
    expect(div.getAttribute('class')).toBe('spin')
  })

  it('no-op update (same state reference) does not reconcile', () => {
    interface S {
      count: number
    }
    type M = { type: 'noop' }
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ count: 5 }),
      update: (s) => s, // returns same ref
      view: () => [el('span', {}, [signalText((s) => (s as S).count, ['count'])])],
    })
    h.send({ type: 'noop' })
    expect(container.querySelector('span')!.textContent).toBe('5')
    expect(h.getState().count).toBe(5)
  })
})
