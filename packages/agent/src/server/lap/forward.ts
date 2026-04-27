import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'

export type ForwardDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

/**
 * Generic LAP handler. `parseArgs` is called with the parsed body (may be
 * null for empty bodies); it returns the args object to forward or null
 * to reject as invalid. `tool` is the browser-side tool name.
 */
export function makeForwardHandler(
  tool: string,
  parseArgs: (body: unknown) => object | null,
  auditDetail: (tid: string, args: object) => Record<string, unknown> = () => ({}),
) {
  return async (req: Request, deps: ForwardDeps): Promise<Response> => {
    const auth = await verifyAndReadTid(req, deps.tokenStore)
    if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

    const rec = await deps.tokenStore.findByTid(auth.tid)
    if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
    if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

    const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
    if (!rlCheck.allowed) {
      return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
    }

    const rawBody = req.method === 'POST' ? await req.json().catch(() => null) : null
    const args = parseArgs(rawBody)
    if (args === null) return json({ error: { code: 'invalid' } }, 400)

    try {
      const result = await deps.registry.rpc(auth.tid, tool, args)
      const nowMs = (deps.now ?? (() => Date.now()))()
      await deps.tokenStore.touch(auth.tid, nowMs)
      await deps.auditSink.write({
        at: nowMs,
        tid: auth.tid,
        uid: rec.uid,
        event: 'lap-call',
        detail: { tool, ...auditDetail(auth.tid, args) },
      })
      return json(result, 200)
    } catch (e: unknown) {
      const err = e as { code?: string; detail?: string }
      const code = err.code ?? 'internal'
      const status = code === 'paused' ? 503 : code === 'timeout' ? 504 : 500
      return json({ error: { code, detail: err.detail } }, status)
    }
  }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}

// Concrete handlers:
export const handleLapState = makeForwardHandler('get_state', (body) => {
  const b = (body ?? {}) as { path?: unknown }
  if (b.path !== undefined && typeof b.path !== 'string') return null
  return { path: b.path }
})

export const handleLapQueryState = makeForwardHandler('query_state', (body) => {
  const b = (body ?? {}) as { path?: unknown }
  if (typeof b.path !== 'string') return null
  return { path: b.path }
})

export const handleLapActions = makeForwardHandler('list_actions', () => ({}))

export const handleLapQueryDom = makeForwardHandler('query_dom', (body) => {
  const b = (body ?? {}) as { name?: unknown; multiple?: unknown }
  if (typeof b.name !== 'string') return null
  return { name: b.name, multiple: !!b.multiple }
})

export const handleLapDescribeVisible = makeForwardHandler('describe_visible_content', () => ({}))

export const handleLapContext = makeForwardHandler('describe_context', () => ({}))

export const handleLapWouldDispatch = makeForwardHandler('would_dispatch', (body) => {
  const b = (body ?? {}) as { msg?: unknown }
  if (
    b.msg === null ||
    b.msg === undefined ||
    typeof b.msg !== 'object' ||
    typeof (b.msg as { type?: unknown }).type !== 'string'
  ) {
    return null
  }
  return { msg: b.msg }
})

/**
 * Read recent log entries from the pairing registry's ring buffer.
 * Server-side only — no round-trip to the browser. Used by the
 * agent's `describe_recent_actions` tool to introspect its own
 * activity history without re-fetching state.
 *
 * Diverges from `makeForwardHandler` because the data lives on the
 * server (registry-owned), not the browser. The auth + paused +
 * rate-limit gates run identically.
 */
export async function handleLapRecentActions(req: Request, deps: ForwardDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.tokenStore)
  if (!auth.ok)
    return new Response(JSON.stringify({ error: { code: auth.code } }), {
      status: auth.status,
      headers: { 'content-type': 'application/json' },
    })

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') {
    return new Response(JSON.stringify({ error: { code: 'revoked' } }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (!deps.registry.isPaired(auth.tid)) {
    return new Response(JSON.stringify({ error: { code: 'paused' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return new Response(
      JSON.stringify({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    )
  }

  const body = req.method === 'POST' ? await req.json().catch(() => null) : null
  const b = (body ?? {}) as { n?: unknown; kind?: unknown }
  const n = typeof b.n === 'number' && b.n > 0 ? Math.floor(b.n) : 10
  // Allow filtering by kind so the agent can ask for "just dispatches"
  // without sifting through reads. Default `null` returns all kinds.
  const kindFilter = typeof b.kind === 'string' ? b.kind : null

  let entries = deps.registry.getRecentLog(auth.tid, kindFilter !== null ? 100 : n)
  if (kindFilter !== null) {
    entries = entries.filter((e) => e.kind === kindFilter).slice(0, n)
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { tool: 'describe_recent_actions', count: entries.length, kindFilter },
  })

  return new Response(JSON.stringify({ entries }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
