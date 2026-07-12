import { describe, it, expect, vi } from 'vitest'
import { handleEffects, http, type Effect, type ApiError } from '../src/index'

describe('handleEffects().use()', () => {
  it('plugin handles matching effects and short-circuits', () => {
    const elseFn = vi.fn()
    const send = vi.fn()

    const handler = handleEffects<Effect | { type: 'custom'; data: string }>()
      .use<{ type: 'custom'; data: string }, unknown>(({ effect }) => {
        if (effect.type === 'custom') {
          send({ type: 'handled', data: effect.data })
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

  it('a plugin runs BEFORE the built-in switch and can intercept http', () => {
    // Regression: plugins used to run only in the `.else()` fallthrough, so they
    // could never intercept a built-in kind. They now run first on every dispatch.
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const intercepted: string[] = []
    const handler = handleEffects<Effect>()
      .use<Effect, unknown>(({ effect }) => {
        if (effect.type === 'http') {
          intercepted.push((effect as { url: string }).url)
          return true // claim it — the built-in fetch must NOT run
        }
        return false
      })
      .else(() => {})

    handler({
      effect: http<{ type: string; error?: ApiError }>({
        url: '/api/intercept-me',
        onSuccess: () => ({ type: 'ok' }),
        onError: (err) => ({ type: 'err', error: err }),
      }),
      send: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(intercepted).toEqual(['/api/intercept-me'])
    expect(fetchMock).not.toHaveBeenCalled() // built-in http never fired

    vi.unstubAllGlobals()
  })
})
