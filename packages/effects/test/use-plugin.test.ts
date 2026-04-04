import { describe, it, expect, vi } from 'vitest'
import { handleEffects, type Effect } from '../src/index'

describe('handleEffects().use()', () => {
  it('plugin handles matching effects and short-circuits', () => {
    const elseFn = vi.fn()
    const send = vi.fn()

    const handler = handleEffects<Effect | { type: 'custom'; data: string }>()
      .use(({ effect }) => {
        if (effect.type === 'custom') {
          send({ type: 'handled', data: (effect as { data: string }).data })
          return true
        }
        return false
      })
      .else(elseFn)

    handler({
      effect: { type: 'custom', data: 'hello' } as Effect | { type: 'custom'; data: string },
      send,
      signal: new AbortController().signal,
    })

    expect(send).toHaveBeenCalledWith({ type: 'handled', data: 'hello' })
    expect(elseFn).not.toHaveBeenCalled()
  })

  it('unhandled effects fall through to .else()', () => {
    const elseFn = vi.fn()
    const send = vi.fn()

    const handler = handleEffects<{ type: string }>()
      .use(() => false) // never handles
      .else(elseFn)

    handler({ effect: { type: 'unknown' }, send, signal: new AbortController().signal })

    expect(elseFn).toHaveBeenCalledWith({
      effect: { type: 'unknown' },
      send,
      signal: expect.anything(),
    })
  })

  it('chains multiple plugins — first match wins', () => {
    const calls: string[] = []

    const handler = handleEffects<{ type: string; id: number }>()
      .use(({ effect }) => {
        if ((effect as { id: number }).id === 1) {
          calls.push('plugin1')
          return true
        }
        return false
      })
      .use(({ effect }) => {
        if ((effect as { id: number }).id === 2) {
          calls.push('plugin2')
          return true
        }
        return false
      })
      .else(() => calls.push('else'))

    const send = vi.fn()
    const signal = new AbortController().signal

    handler({ effect: { type: 'x', id: 1 }, send, signal })
    handler({ effect: { type: 'x', id: 2 }, send, signal })
    handler({ effect: { type: 'x', id: 3 }, send, signal })

    expect(calls).toEqual(['plugin1', 'plugin2', 'else'])
  })
})
