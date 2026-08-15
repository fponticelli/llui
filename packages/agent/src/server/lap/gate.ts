import { tokenHashOf } from '../token.js'
import { isSlidingTtlExpired } from '../sliding-ttl.js'
import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import type { AuditEvent, TokenRecord } from '../../protocol.js'
import { buildPausedResponse } from './paused.js'
import { ensureActive } from './active.js'

/**
 * Resolve the bearer token on a request to a `tid`. The opaque-token
 * scheme means "verify" is "look up the SHA-256 hash in the store and
 * check expiry." A missing prefix, an unknown hash, or an expired
 * record all collapse to the same `auth-failed` so a probe-by-hash
 * leak surface is uniform.
 *
 * REVOCATION is the one status this function does read, and it is not
 * folded into that uniform `auth-failed` (#190). Two reasons, in this
 * order:
 *
 *   1. It has to be read HERE, not only by the caller, because this is
 *      the function every ADMISSION gate routes through. The MCP
 *      router treats a verified bearer as an admission credential: an
 *      `initialize` carrying one is marked `admitted`, which puts the
 *      session OUTSIDE `maxUnauthenticatedSessions` and makes it
 *      un-evictable for an anonymous caller. Revocation was enforced
 *      only at tool-call time, so a revoked token could not DRIVE the
 *      app but could still buy un-evictable slots — resource admission
 *      for a dead `tid`. "Revoked" has to mean revoked at every gate,
 *      not only the last one.
 *   2. It answers `403 revoked` rather than `401 auth-failed` because
 *      that is what this codebase already answers everywhere else the
 *      status is read — `withLapGates`' own follow-up check below and
 *      `acceptConnection`'s WS admission both do — and the client
 *      surface acts on it ("paste a new snippet"). Collapsing it into
 *      `auth-failed` would keep the leak surface marginally more
 *      uniform at the cost of changing an established answer, and the
 *      "oracle" it costs is only reachable by someone already holding
 *      the token value.
 *
 * Every OTHER status (paused / pending-resume / …) remains the
 * caller's job — the LAP gate does its own follow-up `findByTid` for
 * those, and its revoked branch is kept as defence in depth (it also
 * covers a record that vanished between the two reads).
 */
export type VerifyTidOptions = {
  /** Wall clock in ms; injectable for tests. Defaults to `Date.now()`. */
  now?: number
  /**
   * Sliding (inactivity) TTL in ms. When set, a token whose
   * `lastSeenAt + slidingTtlMs` is in the past collapses to the same
   * `auth-failed` as a hard-expired or unknown token. Undefined / `0`
   * disables the check.
   */
  slidingTtlMs?: number
}

export async function verifyAndReadTid(
  req: Request,
  tokenStore: TokenStore,
  opts: VerifyTidOptions = {},
): Promise<{ ok: true; tid: string } | { ok: false; status: number; code: string }> {
  const nowMs = opts.now ?? Date.now()
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, code: 'auth-failed' }
  const token = auth.slice('Bearer '.length)
  const hash = await tokenHashOf(token)
  if (!hash) return { ok: false, status: 401, code: 'auth-failed' }
  const rec = await tokenStore.findByTokenHash(hash)
  if (!rec) return { ok: false, status: 401, code: 'auth-failed' }
  if (rec.expiresAt <= nowMs) return { ok: false, status: 401, code: 'auth-failed' }
  // Sliding (inactivity) expiry — folded into the same uniform
  // `auth-failed` so an idle-token probe is indistinguishable from any
  // other invalid bearer.
  if (isSlidingTtlExpired(rec, opts.slidingTtlMs, nowMs)) {
    return { ok: false, status: 401, code: 'auth-failed' }
  }
  // A revoked token verifies as "ours" but must buy NOTHING — see the
  // doc comment.
  //
  // BE PRECISE ABOUT WHAT THIS CLOSES, because #190 as filed was not:
  // on the bundled `InMemoryTokenStore` this branch is UNREACHABLE
  // through `revoke()`. That method deletes the `tokenHash` index entry,
  // so `findByTokenHash` returns null and the lookup above already bails
  // `401`. Measured both ways at `maxUnauthenticatedSessions: 1`: mint →
  // `revoke(tid)` → `initialize` was 401 with occupancy 0 BEFORE this
  // check and is identical after; only a record whose status is
  // `revoked` while its hash is STILL INDEXED returned 200 and survived
  // an anonymous burst.
  //
  // That shape is a custom `TokenStore`, and it is a supported one: the
  // interface does not require dropping the index, and the row is
  // deliberately kept "for audit / replay purposes". So this is genuine
  // defence in depth for an implementor who keeps the row queryable —
  // not a fix for a reachable hole in the shipped store.
  if (rec.status === 'revoked') return { ok: false, status: 403, code: 'revoked' }
  return { ok: true, tid: rec.tid }
}

/**
 * The dependency bag every LAP handler needs. Previously copy-pasted as
 * six identical `LapXxxDeps` aliases across the handler files; now one
 * type owns the shape.
 */
export type LapGateDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
  /** Sliding (inactivity) TTL in ms; folded into the verify path. */
  slidingTtlMs?: number
}

/**
 * Hard ceiling on a LAP request JSON body (bytes). LAP payloads (a Msg +
 * a few options) are tiny; a multi-MB body is a bug or an abuse attempt.
 * A declared `Content-Length` over the ceiling is rejected up front, and
 * the body is ALSO read through a byte-counting reader
 * ({@link readJsonCapped}) so a chunked / undeclared-length request can't
 * skip the check and stream an unbounded payload into `JSON.parse`.
 */
const MAX_LAP_BODY_BYTES = 1024 * 1024

/**
 * Outcome of {@link readJsonCapped}:
 *   - `ok`        — the body parsed (or was malformed JSON, surfaced as
 *     `body: null` so callers keep their existing "invalid → 400" path
 *     rather than throwing).
 *   - `empty`     — no body / whitespace-only. Callers that default the
 *     body (`?? {}`) treat this the same as `{ body: null }`.
 *   - `too-large` — the byte count crossed `maxBytes` mid-stream; the
 *     reader was cancelled and the gate answers 413.
 */
export type CappedJsonResult =
  | { status: 'ok'; body: unknown }
  | { status: 'empty' }
  | { status: 'too-large' }

/**
 * Read a request body through a byte-counting stream reader, aborting the
 * moment the running total crosses `maxBytes`. This is the ONLY size gate
 * that holds for a chunked / `Transfer-Encoding` request: `Content-Length`
 * is absent there, so a `req.json()` that trusts the header would buffer
 * the whole payload. Streaming with a hard cap bounds memory regardless of
 * how the body is framed.
 */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<CappedJsonResult> {
  const stream = req.body
  if (!stream) return { status: 'empty' }

  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { status: 'too-large' }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (total === 0) return { status: 'empty' }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  const text = new TextDecoder().decode(merged)
  if (text.trim() === '') return { status: 'empty' }
  try {
    return { status: 'ok', body: JSON.parse(text) as unknown }
  } catch {
    // Malformed JSON — mirror the handlers' historical `.catch(() => null)`
    // so a bad body surfaces through their existing invalid-body path.
    return { status: 'ok', body: null }
  }
}

/**
 * Canonical JSON responder — one copy instead of the seven byte-identical
 * private `json()` helpers that used to live in each handler file.
 */
export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Request context handed to a gated handler. The auth / paused /
 * rate-limit gates have already run by the time the handler body sees
 * this, so it carries the resolved `tid` + `rec` plus the small set of
 * post-gate primitives (`markActive`, `touch`, `audit`) and a `finish`
 * terminal for the common single-audit `lap-call` shape.
 */
export type LapContext = {
  req: Request
  deps: LapGateDeps
  tid: string
  rec: TokenRecord
  /**
   * The request's JSON body, read ONCE by the gate through a byte-capped
   * reader (see {@link readJsonCapped}) so a chunked/undeclared-length
   * body can't bypass the size limit. `null` for an empty body or one
   * that failed to parse (handlers keep their existing "null → invalid"
   * checks). Handlers MUST read this instead of `req.json()` — the gate
   * has already consumed the stream, so a second read would hang/throw.
   */
  body: unknown
  /** Resolved wall-clock reader (`deps.now ?? Date.now`). */
  now: () => number
  /** Shared JSON responder (same as the exported `json`). */
  json: (body: unknown, status: number) => Response
  /**
   * Emit the canonical 503 `paused` response for this tid — used when a
   * WS drops mid-request (RPC rejects with `paused`) or the hello frame
   * is missing.
   */
  paused: () => Promise<Response>
  /** `awaiting-claude` → `active` transition + browser notify. */
  markActive: (nowMs: number) => Promise<void>
  /** Refresh the sliding-TTL clock. */
  touch: (nowMs: number) => Promise<void>
  /** Write one audit entry (uid pulled from `rec`). */
  audit: (event: AuditEvent, detail: object, at: number) => Promise<void>
  /**
   * Terminal for the common "one lap-call audit then 200" handlers: runs
   * `markActive`, touches (only when `touchOn: 'completion'` — arrival
   * handlers already touched in the gate), writes one audit entry, and
   * returns `json(out, 200)`.
   */
  finish: (out: unknown, audit?: { event?: AuditEvent; detail?: object }) => Promise<Response>
}

export type LapGateOptions = {
  /**
   * When the sliding-TTL clock is refreshed relative to the handler body.
   *
   *   - `'arrival'` — touch the moment the request lands, BEFORE the
   *     handler runs. Required for the long-poll endpoints (`/wait`,
   *     `/confirm-result`) which can block past `slidingTtlMs`; touching
   *     only after they resolve would let the inactivity expiry kill an
   *     actively-polling agent.
   *   - `'completion'` — touch inside `ctx.finish` (or the handler's own
   *     terminal), after the work is done. The default for the short
   *     request/response endpoints.
   *
   * This policy difference is preserved explicitly rather than by
   * omission — `/wait` and `/confirm-result` pass `'arrival'`, all
   * others `'completion'`.
   */
  touchOn: 'arrival' | 'completion'
}

/**
 * The shared LAP gate sequence:
 *
 *   verifyAndReadTid → findByTid → revoked? → isPaired/paused →
 *   rate-limit → (touch@arrival) → handler → (finish: markActive →
 *   touch@completion → audit → json)
 *
 * Every LAP handler runs this identical prefix; only the body-parse +
 * work + audit-detail differ. `makeForwardHandler` already modelled the
 * whole thing for the simple forwards — this generalizes it so the
 * bespoke handlers (`/message`, `/confirm-result`, `/observe`, …) share
 * the same gate instead of hand-rolling it.
 */
export function withLapGates(
  opts: LapGateOptions,
  handler: (ctx: LapContext) => Promise<Response>,
): (req: Request, deps: LapGateDeps) => Promise<Response> {
  return async (req, deps) => {
    // Cap the request body before doing any work: a declared
    // Content-Length over the ceiling is rejected with 413 rather than
    // parsed. Bounds memory on the LAP surface (there was previously no
    // message-size limit).
    const contentLength = Number(req.headers.get('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_LAP_BODY_BYTES) {
      return json({ error: { code: 'payload-too-large' } }, 413)
    }

    const auth = await verifyAndReadTid(req, deps.tokenStore, { slidingTtlMs: deps.slidingTtlMs })
    if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

    const rec = await deps.tokenStore.findByTid(auth.tid)
    if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
    if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

    const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
    if (!rlCheck.allowed) {
      return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
    }

    // Read + cap the body ONCE, here, through a byte-counting reader. The
    // Content-Length pre-check above is a cheap early-out; this is the
    // check that actually holds for a chunked request (no Content-Length),
    // which previously streamed straight into a handler's `req.json()`.
    const parsed = await readJsonCapped(req, MAX_LAP_BODY_BYTES)
    if (parsed.status === 'too-large') {
      return json({ error: { code: 'payload-too-large' } }, 413)
    }
    const body = parsed.status === 'ok' ? parsed.body : null

    const nowFn = deps.now ?? (() => Date.now())

    // Long-poll endpoints refresh the clock at arrival so a request that
    // blocks past `slidingTtlMs` doesn't expire under the agent.
    if (opts.touchOn === 'arrival') {
      await deps.tokenStore.touch(auth.tid, nowFn())
    }

    const ctx: LapContext = {
      req,
      deps,
      tid: auth.tid,
      rec,
      body,
      now: nowFn,
      json,
      paused: () => buildPausedResponse(deps.tokenStore, auth.tid),
      markActive: (nowMs) => ensureActive(deps.tokenStore, deps.registry, auth.tid, rec, nowMs),
      touch: (nowMs) => Promise.resolve(deps.tokenStore.touch(auth.tid, nowMs)),
      audit: (event, detail, at) =>
        Promise.resolve(deps.auditSink.write({ at, tid: auth.tid, uid: rec.uid, event, detail })),
      async finish(out, audit) {
        const nowMs = nowFn()
        await ensureActive(deps.tokenStore, deps.registry, auth.tid, rec, nowMs)
        if (opts.touchOn === 'completion') await deps.tokenStore.touch(auth.tid, nowMs)
        await deps.auditSink.write({
          at: nowMs,
          tid: auth.tid,
          uid: rec.uid,
          event: audit?.event ?? 'lap-call',
          detail: audit?.detail ?? {},
        })
        return json(out, 200)
      },
    }

    return handler(ctx)
  }
}
