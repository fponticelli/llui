import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import { buildPausedResponse } from './paused.js'
import { ensureActive } from './active.js'
import type { LapNarrateRequest, LapNarrateResponse, LogEntry } from '../../protocol.js'

export type LapNarrateDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
  /** Sliding (inactivity) TTL in ms; folded into the verify path. */
  slidingTtlMs?: number
}

/**
 * `narrate` LAP handler. Synthesizes a `LogEntry { kind: 'narrate' }`
 * and:
 *
 *   1. pushes a `log-push` server frame to the paired runtime so the
 *      in-app activity feed renders the narration in real time;
 *   2. (the runtime echoes a `log-append` of the same id back to the
 *      server through the existing browser → server channel — that
 *      drives audit + recent-log persistence). The handler does NOT
 *      record into recent-log directly here, to keep ONE writer per
 *      buffer — server-side push, client-side echo, single audit
 *      pathway.
 *
 * The agent receives `{ ok: true }` once the server has accepted the
 * narration. If the pairing is paused, the call returns 503 paused
 * (same as every other LAP write) — the agent can retry once the
 * runtime is back.
 */
export async function handleLapNarrate(req: Request, deps: LapNarrateDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.tokenStore, { slidingTtlMs: deps.slidingTtlMs })
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as LapNarrateRequest
  if (typeof body.text !== 'string' || body.text.length === 0) {
    return json({ error: { code: 'invalid', detail: 'text required' } }, 400)
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  const entry: LogEntry = {
    id: `narrate-${nowMs}-${crypto.randomUUID().slice(0, 8)}`,
    at: nowMs,
    kind: 'narrate',
    intent: body.intent ?? 'Agent narrated',
    detail: body.text,
  }
  // Push to the paired runtime. The runtime's ws-client mirrors it via
  // onLogEntry into local slices AND echoes a log-append frame back
  // here, which the registry routes through its existing recent-log +
  // audit-sink path — so we don't need to double-record server-side.
  deps.registry.send(auth.tid, { t: 'log-push', entry })

  await ensureActive(deps.tokenStore, deps.registry, auth.tid, rec, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/narrate', outcome: 'ok' },
  })
  const out: LapNarrateResponse = { ok: true }
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
