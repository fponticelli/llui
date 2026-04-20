import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'

export type ForwardDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
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
    const auth = verifyAndReadTid(req, deps.signingKey)
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

export const handleLapActions = makeForwardHandler('list_actions', () => ({}))

export const handleLapQueryDom = makeForwardHandler('query_dom', (body) => {
  const b = (body ?? {}) as { name?: unknown; multiple?: unknown }
  if (typeof b.name !== 'string') return null
  return { name: b.name, multiple: !!b.multiple }
})

export const handleLapDescribeVisible = makeForwardHandler('describe_visible_content', () => ({}))

export const handleLapContext = makeForwardHandler('describe_context', () => ({}))
