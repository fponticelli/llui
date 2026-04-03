import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/ssr'
import { component, div, span, button, text, show } from '../src/index'

type State = { count: number; label: string }
type Msg = { type: 'inc' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0, label: 'hello' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
    }
  },
  view: (_state, send) => [
    div({ class: 'counter', id: 'main' }, [
      span({}, [text((s: State) => s.label)]),
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    ...show<State>({
      when: (s) => s.count > 0,
      render: (_s, _send) => [span({ class: 'badge' }, [text('active')])],
    }),
  ],
  __dirty: (o, n) =>
    (Object.is(o.count, n.count) ? 0 : 0b01) |
    (Object.is(o.label, n.label) ? 0 : 0b10),
})

describe('renderToString', () => {
  it('renders initial state to HTML', () => {
    const html = renderToString(Counter)
    expect(html).toContain('<div')
    expect(html).toContain('class="counter"')
    expect(html).toContain('id="main"')
    expect(html).toContain('hello')
    expect(html).toContain('0')
    expect(html).toContain('+')
  })

  it('renders with custom initial data', () => {
    const html = renderToString(Counter, { count: 5, label: 'world' })
    expect(html).toContain('world')
    expect(html).toContain('5')
  })

  it('evaluates show() conditionally', () => {
    const html0 = renderToString(Counter)
    expect(html0).not.toContain('badge')
    expect(html0).not.toContain('active')

    const html5 = renderToString(Counter, { count: 5, label: 'x' })
    expect(html5).toContain('badge')
    expect(html5).toContain('active')
  })

  it('adds data-llui-hydrate markers on reactive binding sites', () => {
    const html = renderToString(Counter)
    expect(html).toContain('data-llui-hydrate')
  })

  it('does not include event handler attributes', () => {
    const html = renderToString(Counter)
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onClick')
  })

  it('produces valid HTML that can be parsed', () => {
    const html = renderToString(Counter)
    const div = document.createElement('div')
    div.innerHTML = html
    expect(div.querySelector('.counter')).not.toBeNull()
    expect(div.querySelector('#main')).not.toBeNull()
  })
})
