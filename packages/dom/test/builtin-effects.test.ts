import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type State = { value: string }
type Msg = { type: 'start' } | { type: 'done' }
type Eff = { type: 'delay'; ms: number; onDone: Msg } | { type: 'log'; message: string }

describe('built-in delay effect', () => {
  it('dispatches onDone message after timeout', async () => {
    vi.useFakeTimers()

    let sendFn: (msg: Msg) => void
    const def: ComponentDef<State, Msg, Eff> = {
      name: 'Delay',
      init: () => [{ value: 'waiting' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'start':
            return [state, [{ type: 'delay', ms: 100, onDone: { type: 'done' } }]]
          case 'done':
            return [{ value: 'done' }, []]
        }
      },
      view: ({ send }) => {
        sendFn = send
        return [text((s: State) => s.value)]
      },
      __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn!({ type: 'start' })
    handle.flush()
    expect(container.textContent).toBe('waiting')

    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()
    handle.flush()

    expect(container.textContent).toBe('done')

    vi.useRealTimers()
  })
})

describe('built-in log effect', () => {
  it('calls console.log with the message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    let sendFn: (msg: { type: 'go' }) => void
    const def: ComponentDef<object, { type: 'go' }, { type: 'log'; message: string }> = {
      name: 'Log',
      init: () => [{}, []],
      update: (_state, msg) => {
        switch (msg.type) {
          case 'go':
            return [{}, [{ type: 'log', message: 'hello world' }]]
        }
      },
      view: ({ send }) => {
        sendFn = send
        return [text('x')]
      },
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    sendFn!({ type: 'go' })
    handle.flush()

    expect(spy).toHaveBeenCalledWith('hello world')
    spy.mockRestore()
  })
})
