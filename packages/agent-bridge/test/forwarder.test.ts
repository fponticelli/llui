import { describe, it, expect, vi } from 'vitest'
import { forwardLap } from '../src/forwarder.js'

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
    const result = await forwardLap('https://app/lap/v1', 'tok', '/state', { path: '/count' }, { fetch })
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
})
