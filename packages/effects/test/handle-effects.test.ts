import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, cancel, debounce, type Effect } from '../src/index'

type CustomEffect = { type: 'custom'; data: string }
type AllEffects = Effect | CustomEffect
type Send = (msg: Record<string, unknown>) => void

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
    const handler = handleEffects<AllEffects>().else((eff, send) => {
      if (eff.type === 'custom') {
        send({ type: 'custom', data: eff.data })
      }
    })

    handler({ type: 'custom', data: 'hello' }, send, signal)
    expect(send).toHaveBeenCalledWith({ type: 'custom', data: 'hello' })
  })

  it('handles http effects via fetch', async () => {
    const mockResponse = { ok: true, json: () => Promise.resolve({ items: [] }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse))

    const handler = handleEffects<AllEffects>().else(() => {})

    handler(
      http({ url: '/api/data', onSuccess: 'results', onError: 'error' }),
      send,
      signal,
    )

    // Wait for the fetch promise to resolve
    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    expect(send).toHaveBeenCalledWith({ type: 'results', payload: { items: [] } })
    expect(fetch).toHaveBeenCalledWith('/api/data', expect.objectContaining({ signal }))

    vi.unstubAllGlobals()
  })

  it('handles http error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    const handler = handleEffects<AllEffects>().else(() => {})

    handler(
      http({ url: '/api/data', onSuccess: 'results', onError: 'error' }),
      send,
      signal,
    )

    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    expect(send).toHaveBeenCalledWith({
      type: 'error',
      error: expect.objectContaining({ message: 'network' }),
    })

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

    // Start an http request with token 'search'
    handler(
      cancel('search', http({ url: '/api/search', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    )

    // Cancel it
    handler(cancel('search'), send, signal)

    await vi.waitFor(() => expect(fetchAborted).toBe(true))

    // No success or error message should have been sent
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('cancel(token, inner) replaces in-flight request', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ n: callCount }) })
      }),
    )

    const handler = handleEffects<AllEffects>().else(() => {})

    // First request
    handler(
      cancel('search', http({ url: '/api/1', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    )

    // Replace with second request
    handler(
      cancel('search', http({ url: '/api/2', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    )

    await vi.waitFor(() => expect(send).toHaveBeenCalled())

    // Only the second request's result should arrive
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
            setTimeout(() => resolve({ ok: true, json: () => Promise.resolve({}) }), 100)
          }),
      ),
    )

    const handler = handleEffects<AllEffects>().else(() => {})

    handler(
      cancel('search', http({ url: '/api/data', onSuccess: 'results', onError: 'error' })),
      send,
      signal,
    )

    // Abort the component
    controller.abort()

    // Wait a bit — no messages should arrive
    await new Promise((r) => setTimeout(r, 50))
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
