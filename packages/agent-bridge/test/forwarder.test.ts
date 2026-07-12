import { describe, it, expect, vi } from 'vitest'
import { forwardLap, budgetForPath } from '../src/forwarder.js'

function makeFetch(status: number, jsonBody: unknown, throws?: Error): typeof fetch {
  return vi.fn(async (_input, _init) => {
    if (throws) throw throws
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
    } as Response
  })
}

describe('forwardLap', () => {
  it('200 happy path — returns ok:true with parsed body', async () => {
    const body = { state: { count: 42 } }
    const fetch = makeFetch(200, body)
    const result = await forwardLap(
      'https://app/lap/v1',
      'tok',
      '/state',
      { path: '/count' },
      { fetch },
    )
    expect(result).toEqual({ ok: true, body })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://app/lap/v1/state')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ path: '/count' }))
  })

  it('503 error — returns ok:false with status and error body', async () => {
    const errBody = { error: { code: 'paused' } }
    const fetch = makeFetch(503, errBody)
    const result = await forwardLap('https://app/lap/v1', 'tok', '/state', {}, { fetch })
    expect(result).toEqual({ ok: false, status: 503, error: errBody })
  })

  it('401 error — returns ok:false with status 401', async () => {
    const errBody = { error: { code: 'unauthorized' } }
    const fetch = makeFetch(401, errBody)
    const result = await forwardLap('https://app/lap/v1', 'bad-token', '/state', {}, { fetch })
    expect(result).toEqual({ ok: false, status: 401, error: errBody })
  })

  it('network error (fetch throws) — returns ok:false with status 0 and code:network', async () => {
    const fetch = makeFetch(0, null, new Error('ECONNREFUSED'))
    const result = await forwardLap('https://app/lap/v1', 'tok', '/state', {}, { fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(0)
      expect((result.error as { code: string }).code).toBe('network')
    }
  })

  it('baseUrl with trailing slash — joined correctly without double slash', async () => {
    const fetch = makeFetch(200, { ok: true })
    await forwardLap('https://app/lap/v1/', 'tok', '/describe', {}, { fetch })
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toBe('https://app/lap/v1/describe')
  })

  it('passes an abort signal (with a per-endpoint timeout) to fetch', async () => {
    const fetch = makeFetch(200, { ok: true })
    await forwardLap('https://app/lap/v1', 'tok', '/observe', {}, { fetch })
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts (TimeoutError) map to a network error with a timeout detail', async () => {
    const timeoutErr = new DOMException('The operation timed out.', 'TimeoutError')
    const fetch = makeFetch(0, null, timeoutErr)
    const result = await forwardLap('https://app/lap/v1', 'tok', '/observe', {}, { fetch })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(0)
      const err = result.error as { code: string; detail: string }
      expect(err.code).toBe('network')
      expect(err.detail).toMatch(/timed out after 20000ms/)
    }
  })

  it('actually fires the abort when fetch outlives the budget', async () => {
    // A fetch that only rejects when its AbortSignal fires. `/message`
    // with a tiny caller timeout gives a ~2s budget floor via the
    // margin; we shrink the wait by overriding the args timeout to a
    // value whose budget is small enough for the test but still real.
    const hangUntilAbort = vi.fn((_input: unknown, init: RequestInit) => {
      const signal = init.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as Error))
      })
    }) as unknown as typeof fetch
    // budget = timeoutMs(10) + 2000 margin = 2010ms — dominated by margin,
    // so assert the mapping rather than pinning the exact duration.
    const result = await forwardLap(
      'https://app/lap/v1',
      'tok',
      '/message',
      { timeoutMs: 10 },
      { fetch: hangUntilAbort },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect((result.error as { code: string }).code).toBe('network')
  }, 10_000)
})

describe('budgetForPath', () => {
  it('reads get a flat 20s ceiling', () => {
    expect(budgetForPath('/observe', {})).toBe(20_000)
    expect(budgetForPath('/state', {})).toBe(20_000)
    expect(budgetForPath('/describe', {})).toBe(20_000)
    expect(budgetForPath('/actions', {})).toBe(20_000)
  })

  it('long-poll endpoints fall back to their server default + margin', () => {
    expect(budgetForPath('/message', {})).toBe(5_000 + 2_000)
    expect(budgetForPath('/wait', {})).toBe(10_000 + 2_000)
    expect(budgetForPath('/confirm-result', {})).toBe(5_000 + 2_000)
  })

  it('long-poll endpoints honor a caller-supplied timeoutMs + margin', () => {
    expect(budgetForPath('/message', { timeoutMs: 30_000 })).toBe(30_000 + 2_000)
    expect(budgetForPath('/wait', { timeoutMs: 60_000 })).toBe(60_000 + 2_000)
  })

  it('ignores a non-positive or non-numeric timeoutMs', () => {
    expect(budgetForPath('/message', { timeoutMs: 0 })).toBe(5_000 + 2_000)
    expect(budgetForPath('/message', { timeoutMs: -5 })).toBe(5_000 + 2_000)
    expect(budgetForPath('/message', { timeoutMs: 'nope' as unknown as number })).toBe(
      5_000 + 2_000,
    )
  })
})
