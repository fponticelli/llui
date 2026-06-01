import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { unsafeHtml, div } from '../../src/signals/authoring'

// `unsafeHtml()` parses an HTML string and renders the resulting nodes inline
// (between anchor comments, no wrapper element). Reactive on a `Signal<string>`:
// when the string changes, the previous fragment is removed and the new one
// parsed in. A plain string renders once and never updates.

interface S {
  html: string
}

describe('unsafeHtml()', () => {
  it('parses and renders an HTML fragment inline, reactively', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'set'; v: string }>(container, {
      init: () => ({ html: '<b>hi</b>' }),
      update: (s, m) => (m.type === 'set' ? { html: m.v } : s),
      view: ({ state }) => [div({}, [unsafeHtml(state.at('html'))])],
    })

    const host = container.querySelector('div')!
    expect(host.querySelector('b')?.textContent).toBe('hi')

    h.send({ type: 'set', v: '<i>bye</i><span>x</span>' })
    expect(host.querySelector('b')).toBeNull() // old fragment removed
    expect(host.querySelector('i')?.textContent).toBe('bye')
    expect(host.querySelector('span')?.textContent).toBe('x')

    h.dispose()
  })

  it('renders a static string once', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'noop' }>(container, {
      init: () => ({ html: '' }),
      update: (s) => s,
      view: () => [div({}, [unsafeHtml('<em>static</em>')])],
    })
    expect(container.querySelector('em')?.textContent).toBe('static')
    h.dispose()
  })

  it('clears to empty when the string becomes empty', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'set'; v: string }>(container, {
      init: () => ({ html: '<p>content</p>' }),
      update: (s, m) => (m.type === 'set' ? { html: m.v } : s),
      view: ({ state }) => [div({}, [unsafeHtml(state.at('html'))])],
    })
    const host = container.querySelector('div')!
    expect(host.querySelector('p')?.textContent).toBe('content')
    h.send({ type: 'set', v: '' })
    expect(host.querySelector('p')).toBeNull()
    h.dispose()
  })
})
