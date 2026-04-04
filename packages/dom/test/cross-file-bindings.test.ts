import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text, branch, flush } from '../src/index'

/**
 * Simulates the cross-file pattern: a view function defined outside
 * the component file. In production, the compiler assigns masks
 * independently per file. This test verifies that bindings in
 * imported view functions update correctly when state changes.
 */
describe('cross-file bindings', () => {
  type State = { page: 'a' | 'b'; label: string }
  type Msg = { type: 'setLabel'; value: string } | { type: 'switchPage' }

  // Simulates an imported view function — bindings here use FULL_MASK
  // in production because there's no component() in the view file
  function pageA(_send: (msg: Msg) => void): Node[] {
    return [div({ class: 'page-a' }, [text((s: State) => s.label)])]
  }

  function pageB(_send: (msg: Msg) => void): Node[] {
    return [div({ class: 'page-b' }, [text((s: State) => `Page B: ${s.label}`)])]
  }

  it('updates text in branch case when state changes', () => {
    let sendFn: (msg: Msg) => void

    const App = component<State, Msg, never>({
      name: 'CrossFile',
      init: () => [{ page: 'a', label: 'initial' }, []],
      update: (s, msg) => {
        switch (msg.type) {
          case 'setLabel':
            return [{ ...s, label: msg.value }, []]
          case 'switchPage':
            return [{ ...s, page: s.page === 'a' ? 'b' : 'a' }, []]
        }
      },
      view: (send) => {
        sendFn = send
        return branch<State, Msg>({
          on: (s) => s.page,
          cases: {
            a: (send) => pageA(send),
            b: (send) => pageB(send),
          },
        })
      },
      __dirty: (o, n) =>
        (Object.is(o.page, n.page) ? 0 : 0b01) | (Object.is(o.label, n.label) ? 0 : 0b10),
    })

    const container = document.createElement('div')
    mountApp(container, App)

    // Initial render
    expect(container.textContent).toBe('initial')

    // Update label — should reflect in the view function's text binding
    sendFn!({ type: 'setLabel', value: 'updated' })
    flush()
    expect(container.textContent).toBe('updated')

    // Switch page
    sendFn!({ type: 'switchPage' })
    flush()
    expect(container.textContent).toBe('Page B: updated')

    // Update label on page B
    sendFn!({ type: 'setLabel', value: 'changed' })
    flush()
    expect(container.textContent).toBe('Page B: changed')
  })
})
