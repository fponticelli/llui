import { withLapGates, type LapGateDeps } from './gate.js'
import type { LapNarrateRequest, LapNarrateResponse, LogEntry } from '../../protocol.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapNarrateDeps = LapGateDeps

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
 * narration. If the pairing is paused, the gate returns 503 paused
 * (same as every other LAP write) — the agent can retry once the
 * runtime is back.
 */
export const handleLapNarrate = withLapGates({ touchOn: 'completion' }, async (ctx) => {
  const body = (ctx.body ?? {}) as LapNarrateRequest
  if (typeof body.text !== 'string' || body.text.length === 0) {
    return ctx.json({ error: { code: 'invalid', detail: 'text required' } }, 400)
  }

  const nowMs = ctx.now()
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
  ctx.deps.registry.send(ctx.tid, { t: 'log-push', entry })

  const out: LapNarrateResponse = { ok: true }
  return ctx.finish(out, { detail: { path: '/lap/v1/narrate', outcome: 'ok' } })
})
