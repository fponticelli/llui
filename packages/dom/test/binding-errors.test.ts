import { describe, it, expect } from 'vitest'
import { mountApp, div, text } from '../src/index'
import type { ComponentDef, Send } from '../src/types'

type State = { value: number }
type Msg = { type: 'bump' }

function makeDef(
  shouldThrowRef: { current: boolean },
  onSend: (s: Send<Msg>) => void,
): ComponentDef<State, Msg, never> {
  return {
    name: 'Boom',
    init: () => [{ value: 0 }, []],
    update: (s, m) => (m.type === 'bump' ? [{ value: s.value + 1 }, []] : [s, []]),
    view: ({ send }) => {
      onSend(send)
      return [
        div({ id: 'target', class: 'a b' }, [
          text((s: State) => {
            if (shouldThrowRef.current) throw new Error('boom inside accessor')
            return String(s.value)
          }),
        ]),
      ]
    },
    __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
  }
}

describe('binding accessor errors (dev mode)', () => {
  it('wraps accessor error with component name, kind, and node descriptor', () => {
    const shouldThrow = { current: false }
    let send: Send<Msg> | null = null
    const def = makeDef(shouldThrow, (s) => {
      send = s
    })
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Flip the flag, dispatch a message, expect a wrapped error on flush
    shouldThrow.current = true
    let caught: unknown = null
    try {
      send!({ type: 'bump' })
      handle.flush()
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    expect(err.message).toContain('Boom') // component name
    expect(err.message).toContain('text') // binding kind
    expect(err.message).toContain('<div') // node descriptor
    expect(err.message).toContain('target') // element id
  })

  it('preserves original error as cause', () => {
    const shouldThrow = { current: false }
    let send: Send<Msg> | null = null
    const def = makeDef(shouldThrow, (s) => {
      send = s
    })
    const handle = mountApp(document.createElement('div'), def)
    shouldThrow.current = true
    let caught: unknown = null
    try {
      send!({ type: 'bump' })
      handle.flush()
    } catch (e) {
      caught = e
    }

    const err = caught as Error & { cause?: Error }
    expect(err.cause).toBeInstanceOf(Error)
    expect((err.cause as Error).message).toBe('boom inside accessor')
  })
})
