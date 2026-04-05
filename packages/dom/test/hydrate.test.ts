import { describe, it, expect } from 'vitest'
import { hydrateApp, renderToString } from '../src/index'
import { component, div, span, button, text, show } from '../src/index'

type State = { count: number; label: string }
type Msg = { type: 'inc' } | { type: 'setLabel'; value: string }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0, label: 'hello' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'setLabel':
        return [{ ...state, label: msg.value }, []]
    }
  },
  view: ({ send }) => [
    div({ class: 'counter' }, [
      span({}, [text((s: State) => s.label)]),
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    ...show<State>({
      when: (s) => s.count > 0,
      render: (_send) => [span({ class: 'badge' }, [text('active')])],
    }),
  ],
  __dirty: (o, n) =>
    (Object.is(o.count, n.count) ? 0 : 0b01) | (Object.is(o.label, n.label) ? 0 : 0b10),
})

describe('hydrateApp', () => {
  it('takes over server-rendered HTML with correct state', () => {
    const serverState: State = { count: 0, label: 'hello' }
    const html = renderToString(Counter, serverState)

    const container = document.createElement('div')
    container.innerHTML = html

    const handle = hydrateApp(container, Counter, serverState)

    // Content matches server state
    expect(container.textContent).toContain('hello')
    expect(container.textContent).toContain('0')

    handle.dispose()
  })

  it('becomes reactive after hydration — updates work', () => {
    const serverState: State = { count: 0, label: 'hello' }
    const html = renderToString(Counter, serverState)

    const container = document.createElement('div')
    container.innerHTML = html

    let sendFn: (msg: Msg) => void
    const def = { ...Counter }
    const origView = Counter.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const handle = hydrateApp(container, def, serverState)

    sendFn!({ type: 'inc' })
    handle.flush()

    expect(container.textContent).toContain('1')

    handle.dispose()
  })

  it('produces correct DOM structure after hydration', () => {
    const serverState: State = { count: 0, label: 'hello' }
    const html = renderToString(Counter, serverState)

    const container = document.createElement('div')
    container.innerHTML = html

    const handle = hydrateApp(container, Counter, serverState)

    // Structure is correct — no duplicates
    expect(container.querySelectorAll('.counter').length).toBe(1)
    expect(container.querySelectorAll('span').length).toBe(1)
    expect(container.querySelectorAll('button').length).toBe(1)
    expect(container.textContent).toContain('hello')

    handle.dispose()
  })

  it('event handlers work after hydration', () => {
    const serverState: State = { count: 0, label: 'hello' }
    const html = renderToString(Counter, serverState)

    const container = document.createElement('div')
    container.innerHTML = html

    const handle = hydrateApp(container, Counter, serverState)

    const btn = container.querySelector('button')!
    btn.click()
    handle.flush()

    expect(container.textContent).toContain('1')

    handle.dispose()
  })
})
