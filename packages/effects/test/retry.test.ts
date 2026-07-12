import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, retry, type Effect, type ApiError } from '../src/index'

type Send = (msg: Record<string, unknown>) => void

function successResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function errorResponse(status: number, headers: Record<string, string> = {}, body: unknown = {}) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  }
}

const retriableHttp = () =>
  http<{ type: string; payload?: unknown; error?: ApiError }>({
    url: '/x',
    onSuccess: (data) => ({ type: 'ok', payload: data }),
    onError: (err) => ({ type: 'err', error: err }),
  })

describe('retry', () => {
  let send: Mock<Send>
  let signal: AbortSignal

  beforeEach(() => {
    send = vi.fn<Send>()
    signal = new AbortController().signal
  })

  it('does NOT retry a non-retriable error (401) — fails fast', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401))
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: retry(retriableHttp(), { maxAttempts: 3, delayMs: 10 }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // A 401 is not retriable — only one request should have been made.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toEqual({ type: 'err', error: { kind: 'unauthorized' } })

    vi.unstubAllGlobals()
  })

  it('does NOT retry a validation error (422) — fails fast', async () => {
    // A 422 with an `errors` body maps to a `validation` ApiError (a 422 with no
    // such body is a generic 5xx-style `server` error, which IS retriable).
    const fetchMock = vi
      .fn()
      .mockResolvedValue(errorResponse(422, {}, { errors: { name: ['required'] } }))
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: retry(retriableHttp(), { maxAttempts: 4, delayMs: 10 }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  it('retries a transient (network) error until it succeeds', async () => {
    let call = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      call++
      if (call === 1) return Promise.reject(new TypeError('network down'))
      return Promise.resolve(successResponse({ ok: 1 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: retry(retriableHttp(), { maxAttempts: 3, delayMs: 1 }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]![0]).toEqual({ type: 'ok', payload: { ok: 1 } })

    vi.unstubAllGlobals()
  })

  it('honors Retry-After on a 429 before retrying', async () => {
    vi.useFakeTimers()
    let call = 0
    const fetchMock = vi.fn().mockImplementation(() => {
      call++
      // Retry-After: 1 second on the first (rate-limited) attempt.
      if (call === 1) return Promise.resolve(errorResponse(429, { 'retry-after': '1' }))
      return Promise.resolve(successResponse({ ok: 1 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: retry(retriableHttp(), { maxAttempts: 3, delayMs: 10 }),
      send,
      signal,
    })

    // Let the first fetch settle.
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The 10ms exponential backoff must NOT trigger the retry — Retry-After
    // (1000ms) dominates.
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Past the full Retry-After window, the retry fires and succeeds.
    await vi.advanceTimersByTimeAsync(600)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toEqual({ type: 'ok', payload: { ok: 1 } })

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('respects a custom retryOn predicate', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404))
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})
    handler({
      // Force retrying a normally-non-retriable 404.
      effect: retry(retriableHttp(), { maxAttempts: 2, delayMs: 1, retryOn: () => true }),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    // maxAttempts=2 → one retry → two requests.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})
