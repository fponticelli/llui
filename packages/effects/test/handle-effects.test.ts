import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, cancel, debounce, type Effect } from '../src/index'

type CustomEffect = { type: 'custom'; data: string }
type AllEffects = Effect | CustomEffect
type Send = (msg: Record<string, unknown>) => void

function mockResponse(
  body: unknown,
  opts?: { ok?: boolean; status?: number; contentType?: string },
) {
  const ok = opts?.ok ?? true
  return {
    ok,
    status: opts?.status ?? (ok ? 200 : 500),
    statusText: ok ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': opts?.contentType ?? 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

describe('handleEffects()', () => {
  let send: Mock<Send>
  let signal: AbortSignal
  let controller: AbortController

  beforeEach(() => {
    send = vi.fn<Send>()
    controller = new AbortController()
    signal = controller.signal
  })

  it('passes custom effects to .else()', () => {
    const handler = handleEffects<AllEffects>().else(({ effect, send }) => {
      if (effect.type === 'custom') {
        send({ type: 'custom', data: effect.data })
      }
    })

    handler({ effect: { type: 'custom', data: 'hello' }, send, signal })
    expect(send).toHaveBeenCalledWith({ type: 'custom', data: 'hello' })
  })

  it('handles http effects via fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ items: [] })))

    const handler = handleEffects<AllEffects>().else(() => {})

    handler({
      effect: http({ url: '/api/data', onSuccess: 'results', onError: 'error' }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    expect(send).toHaveBeenCalledWith({ type: 'results', payload: { items: [] } })
    expect(fetch).toHaveBeenCalledWith('/api/data', expect.objectContaining({ signal }))

    vi.unstubAllGlobals()
  })

  it('handles http error with typed ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const handler = handleEffects<AllEffects>().else(() => {})

    handler({
      effect: http({ url: '/api/data', onSuccess: 'results', onError: 'error' }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    expect(send).toHaveBeenCalledWith({
      type: 'error',
      error: { kind: 'network', message: expect.stringContaining('fetch') },
    })

    vi.unstubAllGlobals()
  })

  it('maps 404 to notfound ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({}, { ok: false, status: 404 })))

    const handler = handleEffects<AllEffects>().else(() => {})
    handler({ effect: http({ url: '/api/x', onSuccess: 'ok', onError: 'err' }), send, signal })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'err', error: { kind: 'notfound' } })

    vi.unstubAllGlobals()
  })

  it('maps 429 to ratelimit ApiError with retryAfter', async () => {
    const resp = mockResponse({}, { ok: false, status: 429 })
    resp.headers.set('retry-after', '60')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp))

    const handler = handleEffects<AllEffects>().else(() => {})
    handler({ effect: http({ url: '/api/x', onSuccess: 'ok', onError: 'err' }), send, signal })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'err', error: { kind: 'ratelimit', retryAfter: 60 } })

    vi.unstubAllGlobals()
  })

  it('parses text responses when content-type is not json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse('<h1>Hello</h1>', { contentType: 'text/html' })),
    )

    const handler = handleEffects<AllEffects>().else(() => {})
    handler({ effect: http({ url: '/api/readme', onSuccess: 'ok', onError: 'err' }), send, signal })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith({ type: 'ok', payload: '<h1>Hello</h1>' })

    vi.unstubAllGlobals()
  })

  it('cancel(token) aborts in-flight http', async () => {
    let fetchAborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              fetchAborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )

    const handler = handleEffects<AllEffects>().else(() => {})

    handler({
      effect: cancel(
        'search',
        http({ url: '/api/search', onSuccess: 'results', onError: 'error' }),
      ),
      send,
      signal,
    })

    handler({ effect: cancel('search'), send, signal })

    await vi.waitFor(() => expect(fetchAborted).toBe(true))
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('cancel(token, inner) replaces in-flight request', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve(mockResponse({ n: callCount }))
      }),
    )

    const handler = handleEffects<AllEffects>().else(() => {})

    handler({
      effect: cancel('search', http({ url: '/api/1', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    })

    handler({
      effect: cancel('search', http({ url: '/api/2', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    const lastCall = send.mock.calls[send.mock.calls.length - 1]![0] as Record<string, unknown>
    expect(lastCall.type).toBe('results')

    vi.unstubAllGlobals()
  })

  it('cleans up on abort signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockResponse({})), 100)
          }),
      ),
    )

    const handler = handleEffects<AllEffects>().else(() => {})

    handler({
      effect: cancel('search', http({ url: '/api/data', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    })

    controller.abort()

    await new Promise((r) => setTimeout(r, 50))
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
