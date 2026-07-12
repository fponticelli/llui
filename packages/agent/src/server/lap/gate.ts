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
 * Status check (revoked / paused / etc.) is the caller's job — the gate
 * does its own follow-up `findByTid` to read the current status. This
 * function only cares whether the bearer is one of ours and unexpired.
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
    const auth = await verifyAndReadTid(req, deps.tokenStore, { slidingTtlMs: deps.slidingTtlMs })
    if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

    const rec = await deps.tokenStore.findByTid(auth.tid)
    if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
    if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

    const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
    if (!rlCheck.allowed) {
      return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
    }

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
