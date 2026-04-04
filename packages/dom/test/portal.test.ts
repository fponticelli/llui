import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { portal } from '../src/primitives/portal'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

describe('portal()', () => {
  it('renders children into the target element', () => {
    const target = document.createElement('div')
    target.id = 'portal-target'
    document.body.appendChild(target)

    const def: ComponentDef<object, never, never> = {
      name: 'Portal',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        portal({
          target,
          render: () => [div({ class: 'modal' }, [text('portal content')])],
        }),
    }

    const container = document.createElement('div')
    mountApp(container, def)

    expect(target.querySelector('.modal')).not.toBeNull()
    expect(target.textContent).toBe('portal content')
    // Container should be empty (portal renders elsewhere)
    expect(container.children.length).toBe(0)

    document.body.removeChild(target)
  })

  it('resolves string target via querySelector', () => {
    const target = document.createElement('div')
    target.id = 'string-target'
    document.body.appendChild(target)

    const def: ComponentDef<object, never, never> = {
      name: 'PortalString',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () =>
        portal({
          target: '#string-target',
          render: () => [text('found it')],
        }),
    }

    const container = document.createElement('div')
    mountApp(container, def)

    expect(target.textContent).toBe('found it')

    document.body.removeChild(target)
  })

  it('removes portal nodes on scope disposal', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    type State = { open: boolean }
    type Msg = { type: 'close' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'PortalDispose',
      init: () => [{ open: true }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'close':
            return [{ ...state, open: false }, []]
        }
      },
      view: (send) => {
        sendFn = send
        return show({
          when: (s: State) => s.open,
          render: (_send) =>
            portal({
              target,
              render: () => [div({ class: 'overlay' }, [text('modal')])],
            }),
        })
      },
      __dirty: (o, n) => (Object.is(o.open, n.open) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(target.querySelector('.overlay')).not.toBeNull()

    sendFn!({ type: 'close' })
    handle.flush()

    expect(target.querySelector('.overlay')).toBeNull()

    document.body.removeChild(target)
  })

  it('portal bindings participate in the same update cycle', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)

    type State = { count: number }
    type Msg = { type: 'inc' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'ReactivePortal',
      init: () => [{ count: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'inc':
            return [{ ...state, count: state.count + 1 }, []]
        }
      },
      view: (send) => {
        sendFn = send
        return portal({
          target,
          render: () => [text((s: State) => String(s.count))],
        })
      },
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(target.textContent).toBe('0')

    sendFn!({ type: 'inc' })
    handle.flush()

    expect(target.textContent).toBe('1')

    document.body.removeChild(target)
  })
})
