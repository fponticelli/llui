import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

describe('multiple mountApp instances', () => {
  type State = { visible: boolean }
  type Msg = { type: 'toggle' }

  function toggleDef(label: string): ComponentDef<State, Msg, never> {
    return {
      name: label,
      init: () => [{ visible: false }, []],
      update: (state) => [{ ...state, visible: !state.visible }, []],
      view: (send) => [
        ...show<State>({
          when: (s) => s.visible,
          render: (_send) => [text(label)],
        }),
      ],
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }
  }

  it('structural blocks are isolated — toggling one app does not affect another', () => {
    let sendA: (msg: Msg) => void
    let sendB: (msg: Msg) => void

    const defA = toggleDef('A')
    const origViewA = defA.view
    defA.view = (send) => {
      sendA = send
      return origViewA(send)
    }

    const defB = toggleDef('B')
    const origViewB = defB.view
    defB.view = (send) => {
      sendB = send
      return origViewB(send)
    }

    const containerA = document.createElement('div')
    const containerB = document.createElement('div')
    const handleA = mountApp(containerA, defA)
    const handleB = mountApp(containerB, defB)

    // Both hidden initially
    expect(containerA.textContent).toBe('')
    expect(containerB.textContent).toBe('')

    // Toggle A only
    sendA!({ type: 'toggle' })
    handleA.flush()

    expect(containerA.textContent).toBe('A')
    expect(containerB.textContent).toBe('') // B must be unaffected

    // Toggle B only
    sendB!({ type: 'toggle' })
    handleB.flush()

    expect(containerA.textContent).toBe('A')
    expect(containerB.textContent).toBe('B')

    // Toggle A off
    sendA!({ type: 'toggle' })
    handleA.flush()

    expect(containerA.textContent).toBe('')
    expect(containerB.textContent).toBe('B') // B still unaffected
  })
})
