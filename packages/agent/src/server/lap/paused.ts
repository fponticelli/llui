import type { TokenStore } from '../token-store.js'

/**
 * Build the canonical 503 `paused` response with the reconnect-hint
 * headers. Centralised so every LAP handler that hits an unpaired tid
 * surfaces the same signals to the agent — instead of each handler
 * re-implementing `new Response(...,{status:503})` and silently
 * forgetting the headers.
 *
 * Two headers ship alongside the body:
 *   - `Retry-After: <seconds>` — when the record is in the
 *     `pending-resume` grace window, the time until the window
 *     closes. The agent backs off for that long and retries.
 *   - `X-LLui-Reconnect: pending|revoked|expired|unknown` —
 *     distinguishes "WS bouncing, will be back" (`pending`) from
 *     "session is dead, paste a new snippet" (`revoked`/`expired`).
 *     The agent uses this to decide whether to retry or surface to
 *     the human.
 *
 * The classification is best-effort: a record that's currently
 * `active` or `awaiting-claude` but has no live WS pairing is
 * `pending` (the WS is between sockets — auto-reconnect should
 * close the gap shortly). A record at `pending-resume` is
 * `pending` while within `pendingResumeUntil`, then `expired`. A
 * `revoked` record is `revoked`. Missing / hash-orphaned records
 * (we couldn't even look up the tid) get `unknown` — the agent
 * should treat that the same as `revoked` for safety.
 */
export type ReconnectState = 'pending' | 'revoked' | 'expired' | 'unknown'

/** Default heartbeat window for `pending` states without a TTL. */
const DEFAULT_PENDING_RETRY_S = 5

export async function buildPausedResponse(
  tokenStore: TokenStore,
  tid: string,
  now: number = Date.now(),
): Promise<Response> {
  const rec = await tokenStore.findByTid(tid)
  let reconnect: ReconnectState = 'unknown'
  let retryAfterS = 0

  if (rec) {
    if (rec.status === 'revoked') {
      reconnect = 'revoked'
    } else if (rec.status === 'pending-resume') {
      const until = rec.pendingResumeUntil
      if (until !== null && until > now) {
        reconnect = 'pending'
        retryAfterS = Math.max(1, Math.ceil((until - now) / 1000))
      } else {
        reconnect = 'expired'
      }
    } else {
      // `active` or `awaiting-claude` with no live WS — the close
      // handler hasn't fired yet, or the WS is mid-reconnect. Tell
      // the agent to retry shortly.
      reconnect = 'pending'
      retryAfterS = DEFAULT_PENDING_RETRY_S
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  headers['x-llui-reconnect'] = reconnect
  if (retryAfterS > 0) headers['retry-after'] = String(retryAfterS)

  return new Response(JSON.stringify({ error: { code: 'paused', reconnect } }), {
    status: 503,
    headers,
  })
}
