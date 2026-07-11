import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, log, sequence, race, type Effect, type ApiError } from '../src/index'

type Send = (msg: Record<string, unknown>) => void

function mockResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

describe('sequence', () => {
  let send: Mock<Send>
  let signal: AbortSignal

  beforeEach(() => {
    send = vi.fn<Send>()
    signal = new AbortController().signal
  })

  it('runs effects in order — second starts after first resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        return Promise.resolve(mockResponse({ url }))
      }),
    )

    const handler = handleEffects<Effect>().else(() => {})

    handler({
      effect: sequence([
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/first',
          onSuccess: (data) => ({ type: 'r1', payload: data }),
          onError: (err) => ({ type: 'e1', error: err }),
        }),
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/second',
          onSuccess: (data) => ({ type: 'r2', payload: data }),
          onError: (err) => ({ type: 'e2', error: err }),
        }),
      ]),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    expect(send.mock.calls[0]![0]).toEqual({ type: 'r1', payload: { url: '/first' } })
    expect(send.mock.calls[1]![0]).toEqual({ type: 'r2', payload: { url: '/second' } })

    vi.unstubAllGlobals()
  })

  it('advances past a side-effect-only step (log) instead of stalling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const handler = handleEffects<Effect>().else(() => {})

    handler({
      effect: sequence([
        log('step 1'),
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/after-log',
          onSuccess: (data) => ({ type: 'done', payload: data }),
          onError: (err) => ({ type: 'err', error: err }),
        }),
      ]),
      send,
      signal,
    })

    // The http step must run even though the preceding log step sends no message.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![0]).toEqual({ type: 'done', payload: { ok: 1 } })

    vi.unstubAllGlobals()
  })

  it('does not fast-forward later async steps when a step emits multiple messages', async () => {
    // A never-resolving fetch: lets us observe how many http steps were dispatched
    // synchronously without any of them completing.
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    // A custom effect that emits two messages synchronously.
    const handler = handleEffects<Effect | { type: 'emit-twice' }>().else((ctx) => {
      if (ctx.effect.type === 'emit-twice') {
        ctx.send({ type: 'x1' } as never)
        ctx.send({ type: 'x2' } as never)
      }
    })

    handler({
      effect: sequence([
        { type: 'emit-twice' } as unknown as Effect,
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/a',
          onSuccess: (data) => ({ type: 'a', payload: data }),
          onError: (err) => ({ type: 'ea', error: err }),
        }),
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/b',
          onSuccess: (data) => ({ type: 'b', payload: data }),
          onError: (err) => ({ type: 'eb', error: err }),
        }),
      ]),
      send,
      signal,
    })

    await new Promise((r) => setTimeout(r, 10))

    // The extra 'x2' message must NOT advance the sequence a second time: only the
    // first http (/a) should have fired; /b waits for /a to complete.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/a')

    vi.unstubAllGlobals()
  })
})

describe('race', () => {
  let send: Mock<Send>
  let controller: AbortController

  beforeEach(() => {
    send = vi.fn<Send>()
    controller = new AbortController()
  })

  it('aborts all racers when parent signal aborts', async () => {
    const abortedUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (url: string, opts: { signal: AbortSignal }) =>
          new Promise<Response>((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              abortedUrls.push(url)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )

    const handler = handleEffects<Effect>().else(() => {})

    handler({
      effect: race([
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/a',
          onSuccess: (data) => ({ type: 'a', payload: data }),
          onError: (err) => ({ type: 'e', error: err }),
        }),
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/b',
          onSuccess: (data) => ({ type: 'b', payload: data }),
          onError: (err) => ({ type: 'e', error: err }),
        }),
      ]),
      send,
      signal: controller.signal,
    })

    controller.abort()

    await vi.waitFor(() => expect(abortedUrls.length).toBe(2))
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('only delivers the first result', async () => {
    const resolvers: Array<(v: unknown) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve)
          }),
      ),
    )

    const handler = handleEffects<Effect>().else(() => {})

    handler({
      effect: race([
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/slow',
          onSuccess: (data) => ({ type: 'slow', payload: data }),
          onError: (err) => ({ type: 'e', error: err }),
        }),
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/fast',
          onSuccess: (data) => ({ type: 'fast', payload: data }),
          onError: (err) => ({ type: 'e', error: err }),
        }),
      ]),
      send,
      signal: controller.signal,
    })

    // Resolve the second (fast) first
    resolvers[1]!(mockResponse({ winner: true }))

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(send.mock.calls[0]![0]).toEqual({ type: 'fast', payload: { winner: true } })

    // Resolve the slow one — should be ignored
    resolvers[0]!(mockResponse({ loser: true }))
    await new Promise((r) => setTimeout(r, 50))

    expect(send).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})
