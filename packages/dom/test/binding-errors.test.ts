import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountApp, div, text, span } from '../src/index'
import type { ComponentDef, Send } from '../src/types'

type State = { value: number; other: string }
type Msg = { type: 'bump' } | { type: 'setOther'; v: string }

function makeDef(
  shouldThrowRef: { current: boolean },
  onSend: (s: Send<Msg>) => void,
): ComponentDef<State, Msg, never> {
  return {
    name: 'Boom',
    init: () => [{ value: 0, other: 'fine' }, []],
    update: (s, m) => {
      if (m.type === 'bump') return [{ ...s, value: s.value + 1 }, []]
      if (m.type === 'setOther') return [{ ...s, other: m.v }, []]
      return [s, []]
    },
    view: ({ send }) => {
      onSend(send)
      return [
        div({ id: 'target', class: 'a b' }, [
          text((s: State) => {
            if (shouldThrowRef.current) throw new Error('boom inside accessor')
            return String(s.value)
          }),
        ]),
        span({ id: 'sibling' }, [
          // Sibling binding — has nothing to do with the broken one.
          // Verifies the throw doesn't abort the whole update loop.
          text((s: State) => s.other),
        ]),
      ]
    },
    __dirty: (o, n) => {
      let m = 0
      if (!Object.is(o.value, n.value)) m |= 1
      if (!Object.is(o.other, n.other)) m |= 2
      return m
    },
  }
}

describe('binding accessor errors — isolated catch+continue', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    consoleErr.mockRestore()
  })

  it('flush() does NOT throw when an accessor errors — the loop continues', () => {
    const shouldThrow = { current: false }
    let send: Send<Msg> | null = null
    const def = makeDef(shouldThrow, (s) => {
      send = s
    })
    const handle = mountApp(document.createElement('div'), def)

    shouldThrow.current = true
    expect(() => {
      send!({ type: 'bump' })
      handle.flush()
    }).not.toThrow()
  })

  it('reports the error via console.error in dev mode (no hook wired)', () => {
    const shouldThrow = { current: false }
    let send: Send<Msg> | null = null
    const def = makeDef(shouldThrow, (s) => {
      send = s
    })
    const handle = mountApp(document.createElement('div'), def)

    shouldThrow.current = true
    send!({ type: 'bump' })
    handle.flush()

    expect(consoleErr).toHaveBeenCalled()
    const args = consoleErr.mock.calls[0]
    const reported = args?.[0]
    expect(reported).toBeInstanceOf(Error)
    const err = reported as Error
    // Wrapped message includes component name, binding kind, node descriptor.
    expect(err.message).toContain('Boom')
    expect(err.message).toContain('text')
    expect(err.message).toContain('<div')
    expect(err.message).toContain('target')
    // The original error is preserved as `cause` for stack-walking.
    const errWithCause = err as Error & { cause?: Error }
    expect(errWithCause.cause).toBeInstanceOf(Error)
    expect((errWithCause.cause as Error).message).toBe('boom inside accessor')
  })

  it('sibling bindings on the same commit still update — view does not freeze', () => {
    // The motivating reason for catch+continue: a broken accessor
    // used to abort the whole Phase-2 loop, leaving every other
    // binding stale. Now siblings on the same commit get their
    // updates regardless.
    const shouldThrow = { current: false }
    let send: Send<Msg> | null = null
    const def = makeDef(shouldThrow, (s) => {
      send = s
    })
    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Initially both render correctly: target=0, sibling=fine
    expect(container.querySelector('#target')?.textContent).toBe('0')
    expect(container.querySelector('#sibling')?.textContent).toBe('fine')

    // Flip the accessor to throw, then change the sibling value too.
    // The target binding throws → its DOM stays at 0 (last value).
    // The sibling binding succeeds → its DOM updates to 'changed'.
    shouldThrow.current = true
    send!({ type: 'bump' })
    send!({ type: 'setOther', v: 'changed' })
    handle.flush()

    expect(container.querySelector('#target')?.textContent).toBe('0') // stuck on old value
    expect(container.querySelector('#sibling')?.textContent).toBe('changed') // updated
  })
})
