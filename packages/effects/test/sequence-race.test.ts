import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { handleEffects, http, sequence, race, type Effect } from '../src/index'

type Send = (msg: Record<string, unknown>) => void

describe('sequence', () => {
  let send: Mock<Send>
  let signal: AbortSignal

  beforeEach(() => {
    send = vi.fn<Send>()
    signal = new AbortController().signal
  })

  it('runs effects in order — second starts after first resolves', async () => {
    let callOrder: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        callOrder.push(url)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ url }) })
      }),
    )

    const handler = handleEffects<Effect>().else(() => {})

    handler(
      sequence([
        http({ url: '/first', onSuccess: 'r1', onError: 'e1' }),
        http({ url: '/second', onSuccess: 'r2', onError: 'e2' }),
      ]),
      send,
      signal,
    )

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

    handler(
      race([
        http({ url: '/a', onSuccess: 'a', onError: 'e' }),
        http({ url: '/b', onSuccess: 'b', onError: 'e' }),
      ]),
      send,
      controller.signal,
    )

    controller.abort()

    await vi.waitFor(() => expect(abortedUrls.length).toBe(2))
    expect(send).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('only delivers the first result', async () => {
    let resolvers: Array<(v: Response) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve as (v: Response) => void)
          }),
      ),
    )

    const handler = handleEffects<Effect>().else(() => {})

    handler(
      race([
        http({ url: '/slow', onSuccess: 'slow', onError: 'e' }),
        http({ url: '/fast', onSuccess: 'fast', onError: 'e' }),
      ]),
      send,
      controller.signal,
    )

    // Resolve the second (fast) first
    resolvers[1]!({ ok: true, json: () => Promise.resolve({ winner: true }) } as Response)

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(send.mock.calls[0]![0]).toEqual({ type: 'fast', payload: { winner: true } })

    // Resolve the slow one — should be ignored
    resolvers[0]!({ ok: true, json: () => Promise.resolve({ loser: true }) } as Response)
    await new Promise((r) => setTimeout(r, 50))

    // Still only 1 call
    expect(send).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })
})
