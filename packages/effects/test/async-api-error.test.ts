import { describe, it, expect, vi } from 'vitest'
import { handleEffects, http, type Async, type ApiError } from '../src/index'

describe('Async type', () => {
  it('models idle state', () => {
    const state: Async<string, ApiError> = { type: 'idle' }
    expect(state.type).toBe('idle')
  })

  it('models loading with stale data', () => {
    const state: Async<string[], ApiError> = { type: 'loading', stale: ['old'] }
    expect(state.type).toBe('loading')
    expect(state.stale).toEqual(['old'])
  })

  it('models success', () => {
    const state: Async<number, ApiError> = { type: 'success', data: 42 }
    expect(state.data).toBe(42)
  })

  it('models failure with ApiError', () => {
    const state: Async<string, ApiError> = { type: 'failure', error: { kind: 'notfound' } }
    expect(state.error.kind).toBe('notfound')
  })
})

describe('ApiError mapping from HTTP status', () => {
  it('maps 404 to notfound', async () => {
    const send = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      }),
    )

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'err', error: { kind: 'notfound' } })
    vi.unstubAllGlobals()
  })

  it('maps 401 to unauthorized', async () => {
    const send = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: () => Promise.resolve({}),
      }),
    )

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'err', error: { kind: 'unauthorized' } })
    vi.unstubAllGlobals()
  })

  it('maps 403 to forbidden', async () => {
    const send = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
        json: () => Promise.resolve({}),
      }),
    )

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'err', error: { kind: 'forbidden' } })
    vi.unstubAllGlobals()
  })

  it('maps 422 with errors field to validation', async () => {
    const send = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ errors: { email: ['is invalid'] } }),
      }),
    )

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({
      type: 'err',
      error: { kind: 'validation', fields: { email: ['is invalid'] } },
    })
    vi.unstubAllGlobals()
  })

  it('maps 500 to server error', async () => {
    const send = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: () => Promise.resolve({}),
      }),
    )

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({
      type: 'err',
      error: { kind: 'server', status: 500, message: 'Internal Server Error' },
    })
    vi.unstubAllGlobals()
  })

  it('maps network failure to network error', async () => {
    const send = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const handler = handleEffects().else(() => {})
    handler({
      effect: http({ url: '/x', onSuccess: 'ok', onError: 'err' }),
      send,
      signal: new AbortController().signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({
      type: 'err',
      error: { kind: 'network', message: expect.stringContaining('fetch') },
    })
    vi.unstubAllGlobals()
  })
})
