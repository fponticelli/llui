import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import type { ComponentDef } from '../src/types'
import { text } from '../src/primitives/text'
import { setRenderContext, clearRenderContext } from '../src/render-context'
import { createComponentInstance } from '../src/update-loop'

describe('text()', () => {
  it('creates a static text node for string literals', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'Static',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [text('hello')],
    }
    const container = document.createElement('div')
    const inst = createComponentInstance(def)
    setRenderContext(inst)
    const nodes = def.view(inst.state, inst.send)
    clearRenderContext()
    for (const n of nodes) container.appendChild(n)

    expect(container.textContent).toBe('hello')
  })

  it('creates a reactive text node for accessor functions', () => {
    type State = { label: string }
    const def: ComponentDef<State, { type: 'set'; value: string }, never> = {
      name: 'Reactive',
      init: () => [{ label: 'initial' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'set':
            return [{ ...state, label: msg.value }, []]
        }
      },
      view: () => [text((s: State) => s.label)],
      __dirty: (o, n) => (Object.is(o.label, n.label) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('initial')

    // Trigger an update
    const btn = document.createElement('button')
    container.appendChild(btn)

    // Use the mountApp's internal send by dispatching via the handle
    // Actually, mountApp doesn't expose send — we need to test via the full flow
    // Let's test text reactivity through mountApp properly
  })

  it('updates reactive text when state changes', () => {
    type State = { count: number }
    type Msg = { type: 'inc' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Counter',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ ...state, count: state.count + 1 }, []]
        }
      },
      view: (send) => {
        sendFn = send
        return [text((s: State) => String(s.count))]
      },
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('0')

    sendFn!({ type: 'inc' })
    handle.flush()

    expect(container.textContent).toBe('1')

    sendFn!({ type: 'inc' })
    sendFn!({ type: 'inc' })
    handle.flush()

    expect(container.textContent).toBe('3')
  })
})
