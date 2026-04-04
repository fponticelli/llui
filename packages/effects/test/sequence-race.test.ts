import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, sequence, race, type Effect } from '../src/index'

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
        http({ url: '/first', onSuccess: 'r1', onError: 'e1' }),
        http({ url: '/second', onSuccess: 'r2', onError: 'e2' }),
      ]),
      send,
      signal,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    expect(send.mock.calls[0]![0]).toEqual({ type: 'r1', payload: { url: '/first' } })
    expect(send.mock.calls[1]![0]).toEqual({ type: 'r2', payload: { url: '/second' } })

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
        http({ url: '/a', onSuccess: 'a', onError: 'e' }),
        http({ url: '/b', onSuccess: 'b', onError: 'e' }),
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
        http({ url: '/slow', onSuccess: 'slow', onError: 'e' }),
        http({ url: '/fast', onSuccess: 'fast', onError: 'e' }),
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
