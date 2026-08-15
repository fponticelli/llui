import { describe, it, expect, beforeEach, vi } from 'vitest'
import { withLapGates, readJsonCapped, verifyAndReadTid } from '../../../src/server/lap/gate.js'
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

describe('verifyAndReadTid revocation (#190)', () => {
  const bearerReq = (token: string): Request =>
    new Request('https://app/agent/lap/v1/describe', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

  /**
   * The defect. `verifyAndReadTid` read the record's expiry but never
   * its `status`, so a REVOKED token verified — and every ADMISSION
   * gate routes through this function. Revocation was enforced only at
   * tool-call time, which is why it never showed as an escalation: a
   * revoked token could not drive the app. What it could still do was
   * buy resource admission.
   *
   * Seeded revoked rather than revoked through the store on purpose:
   * `InMemoryTokenStore.revoke` also drops the hash index, so the
   * record would never be found at all and the branch under test would
   * be unreachable. The `TokenStore` interface does not REQUIRE
   * dropping the index (the row is explicitly kept "for audit / replay
   * purposes"), so a persistent store that keeps it indexed is the
   * shape this guards.
   */
  it('refuses a revoked token at the verify boundary', async () => {
    const revoked = await seedToken(store, { tid: 't-dead', uid: 'u1', status: 'revoked' })
    const auth = await verifyAndReadTid(bearerReq(revoked.token), store)
    expect(auth.ok).toBe(false)
    if (auth.ok) return
    expect(auth.status).toBe(403)
    expect(auth.code).toBe('revoked')
  })

  /**
   * …and only revoked. An `active` record still verifies, or this check
   * would be a denial of every request instead of a gate.
   */
  it('still verifies an active token', async () => {
    const auth = await verifyAndReadTid(bearerReq(bearer), store)
    expect(auth).toEqual({ ok: true, tid: 't1' })
  })

  /**
   * The status is the ONLY thing that distinguishes itself. An unknown
   * hash, a missing prefix and an expired record all stay collapsed
   * into one `401 auth-failed` so a probe-by-hash cannot tell them
   * apart — the revoked answer is reachable only by someone already
   * holding the token value.
   */
  it('keeps unknown and expired bearers on the uniform 401', async () => {
    const unknown = await verifyAndReadTid(bearerReq('agt_not-a-real-token'), store)
    expect(unknown).toEqual({ ok: false, status: 401, code: 'auth-failed' })

    const stale = await seedToken(store, { tid: 't-old', uid: 'u1', expiresAt: 10 })
    const expired = await verifyAndReadTid(bearerReq(stale.token), store, { now: 1_000 })
    expect(expired).toEqual({ ok: false, status: 401, code: 'auth-failed' })
  })

  /**
   * The LAP surface's answer is UNCHANGED by moving the check earlier:
   * `403 {"error":{"code":"revoked"}}` is what `withLapGates` returned
   * from its own follow-up `findByTid` check before, and it is what the
   * client acts on ("this session is dead, paste a new snippet"). The
   * follow-up check stays as defence in depth.
   */
  it('leaves the LAP gate answering 403 revoked, byte for byte', async () => {
    const revoked = await seedToken(store, { tid: 't-dead', uid: 'u1', status: 'revoked' })
    const gated = withLapGates({ touchOn: 'completion' }, async () => new Response('reached'))
    const res = await gated(bearerReq(revoked.token), deps())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: { code: 'revoked' } })
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
