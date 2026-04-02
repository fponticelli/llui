import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleEffects, http, sequence, race } from '../src/index'

type Msg = { type: string; payload?: unknown; error?: unknown }
type Eff =
  | ReturnType<typeof http>
  | ReturnType<typeof sequence>
  | ReturnType<typeof race>
  | { type: 'custom'; data: string }

describe('sequence', () => {
  let send: ReturnType<typeof vi.fn>
  let signal: AbortSignal

  beforeEach(() => {
    send = vi.fn()
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

    const handler = handleEffects<Eff>().else(() => {})

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
  let send: ReturnType<typeof vi.fn>
  let controller: AbortController

  beforeEach(() => {
    send = vi.fn()
    controller = new AbortController()
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

    const handler = handleEffects<Eff>().else(() => {})

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
