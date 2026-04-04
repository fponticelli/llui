import { describe, it, expect } from 'vitest'
import { mountApp, flush } from '../src/index'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { count: number }
type Msg = { type: 'inc' }

function counterDef(): ComponentDef<State, Msg, never> {
  return {
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [{ ...state, count: state.count + 1 }, []]
      }
    },
    view: (send) => {
      return [
        div({ class: 'counter' }, [
          text((s: State) => String(s.count)),
          div({ onClick: () => send({ type: 'inc' }) }),
        ]),
      ]
    },
    __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
  }
}

describe('flush()', () => {
  it('forces synchronous DOM update after send()', () => {
    let sendFn: (msg: Msg) => void
    const def = counterDef()
    const origView = def.view
    def.view = (send) => {
      sendFn = send
      return origView(send)
    }

    const container = document.createElement('div')
    mountApp(container, def)

    expect(container.textContent).toContain('0')

    sendFn!({ type: 'inc' })
    // DOM not yet updated (microtask pending)
    expect(container.textContent).toContain('0')

    flush()
    // Now updated
    expect(container.textContent).toContain('1')
  })

  it('is a no-op when no messages are pending', () => {
    const container = document.createElement('div')
    mountApp(container, counterDef())
    // Should not throw
    flush()
  })

  it('works with multiple mounted apps — flushes the right one', () => {
    let sendA: (msg: Msg) => void
    let sendB: (msg: Msg) => void

    const defA = counterDef()
    const origViewA = defA.view
    defA.view = (send) => {
      sendA = send
      return origViewA(send)
    }

    const defB = counterDef()
    const origViewB = defB.view
    defB.view = (send) => {
      sendB = send
      return origViewB(send)
    }

    const containerA = document.createElement('div')
    const containerB = document.createElement('div')
    mountApp(containerA, defA)
    mountApp(containerB, defB)

    sendA!({ type: 'inc' })
    sendB!({ type: 'inc' })
    sendB!({ type: 'inc' })

    flush()

    expect(containerA.textContent).toContain('1')
    expect(containerB.textContent).toContain('2')
  })
})
