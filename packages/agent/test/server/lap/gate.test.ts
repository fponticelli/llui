import { describe, it, expect, beforeEach, vi } from 'vitest'
import { withLapGates, readJsonCapped } from '../../../src/server/lap/gate.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

let store: InMemoryTokenStore
let registry: WsPairingRegistry
let bearer: string

beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const seeded = await seedToken(store, { tid: 't1', uid: 'u1', status: 'active' })
  bearer = seeded.token
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

const deps = () => ({
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
  rateLimiter: permissiveLimiter,
})

// A chunked-style request: a ReadableStream body and NO Content-Length,
// so the header-based pre-check can't see the size. `duplex: 'half'` is
// required by the fetch spec to send a stream body.
function streamingReq(totalBytes: number): Request {
  const CHUNK = 64 * 1024
  const chunk = new Uint8Array(CHUNK).fill(0x78) // 'x'
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
      sent += CHUNK
    },
  })
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: stream,
    duplex: 'half',
  }
  return new Request('https://app/lap/v1/message', init)
}

describe('withLapGates body cap (chunked bypass)', () => {
  it('rejects an oversized CHUNKED body with 413, even with no Content-Length', async () => {
    const handler = vi.fn(async () => new Response('ok'))
    const gated = withLapGates({ touchOn: 'completion' }, handler)
    // 2 MB, over the 1 MB cap, streamed without a Content-Length header.
    const res = await gated(streamingReq(2 * 1024 * 1024), deps())
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error?: { code?: string } }
    expect(body.error?.code).toBe('payload-too-large')
    // The handler never ran — the body was aborted mid-stream.
    expect(handler).not.toHaveBeenCalled()
  })

  it('passes a small chunked body through and exposes it as ctx.body', async () => {
    // Reconstruct a genuine chunked request carrying a tiny JSON payload.
    const payload = JSON.stringify({ msg: { type: 'inc' } })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })
    const init: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    }
    const req = new Request('https://app/lap/v1/message', init)

    let seenBody: unknown
    const gated = withLapGates({ touchOn: 'completion' }, async (ctx) => {
      seenBody = ctx.body
      return new Response('ok')
    })
    const res = await gated(req, deps())
    expect(res.status).toBe(200)
    expect(seenBody).toEqual({ msg: { type: 'inc' } })
  })

  it('still rejects a declared-oversize body via the Content-Length fast path', async () => {
    const req = new Request('https://app/lap/v1/message', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024),
      },
      body: JSON.stringify({ msg: { type: 'inc' } }),
    })
    const gated = withLapGates({ touchOn: 'completion' }, async () => new Response('ok'))
    const res = await gated(req, deps())
    expect(res.status).toBe(413)
  })
})

describe('readJsonCapped', () => {
  it('aborts past the byte cap', async () => {
    const big = 'x'.repeat(2000)
    const req = new Request('https://app', { method: 'POST', body: big })
    expect(await readJsonCapped(req, 1000)).toEqual({ status: 'too-large' })
  })

  it('parses a small JSON body', async () => {
    const req = new Request('https://app', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    expect(await readJsonCapped(req, 1000)).toEqual({ status: 'ok', body: { a: 1 } })
  })

  it('reports an empty body', async () => {
    const req = new Request('https://app', { method: 'GET' })
    expect(await readJsonCapped(req, 1000)).toEqual({ status: 'empty' })
  })

  it('surfaces malformed JSON as ok/null (handlers keep their invalid path)', async () => {
    const req = new Request('https://app', { method: 'POST', body: '{not json' })
    expect(await readJsonCapped(req, 1000)).toEqual({ status: 'ok', body: null })
  })
})
