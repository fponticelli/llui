import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { onMount } from '../src/primitives/on-mount'
import { div } from '../src/elements'
import { show } from '../src/primitives/show'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

describe('onMount()', () => {
  it('fires callback after DOM insertion via microtask', async () => {
    const callback = vi.fn()
    const def: ComponentDef<object, never, never> = {
      name: 'Mount',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => {
        onMount(callback)
        return [div({}, [text('hello')])]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def)

    // Not yet called — fires on microtask
    expect(callback).not.toHaveBeenCalled()

    await Promise.resolve()

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('receives the container element', async () => {
    let receivedEl: Element | undefined
    const def: ComponentDef<object, never, never> = {
      name: 'Mount',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => {
        const el = div({ id: 'target' })
        onMount((e) => {
          receivedEl = e
        })
        return [el]
      },
    }
    const container = document.createElement('div')
    mountApp(container, def)

    await Promise.resolve()

    expect(receivedEl).toBe(container)
  })

  it('cleanup function runs on scope disposal', async () => {
    const cleanup = vi.fn()
    type State = { visible: boolean }
    type Msg = { type: 'hide' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Cleanup',
      init: () => [{ visible: true }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'hide':
            return [{ ...state, visible: false }, []]
        }
      },
      view: ({ send }) => {
        sendFn = send
        return show({
          when: (s: State) => s.visible,
          render: (_send) => {
            onMount(() => cleanup)
            return [text('content')]
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    await Promise.resolve()

    expect(cleanup).not.toHaveBeenCalled()

    sendFn!({ type: 'hide' })
    handle.flush()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('drops callback if scope is disposed before microtask fires', () => {
    const callback = vi.fn()
    type State = { visible: boolean }
    type Msg = { type: 'hide' }
    let sendFn: (msg: Msg) => void

    const def: ComponentDef<State, Msg, never> = {
      name: 'Cancelled',
      init: () => [{ visible: true }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'hide':
            return [{ ...state, visible: false }, []]
        }
      },
      view: ({ send }) => {
        sendFn = send
        return show({
          when: (s: State) => s.visible,
          render: (_send) => {
            onMount(callback)
            return [text('temp')]
          },
        })
      },
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Dispose scope before microtask fires
    sendFn!({ type: 'hide' })
    handle.flush()

    // Callback should never fire
    expect(callback).not.toHaveBeenCalled()
  })
})
