import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import type {
  AgentContext,
  LapActionsResponse,
  LapDescribeResponse,
  LapObserveResponse,
  MessageSchemaEntry,
} from '../../protocol.js'

export type LapObserveDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

/**
 * Unified bootstrap endpoint. One call returns everything the LLM
 * needs to start acting on the app:
 *   - state            (dynamic, from browser)
 *   - actions          (dynamic, from browser)
 *   - description      (static, from cached hello frame)
 *   - context          (dynamic, from browser — agentContext(state))
 *
 * Replaces the get_state + list_actions + describe_app trio at the
 * MCP layer. Those LAP endpoints remain available for specialized
 * callers, but the common "what can I see, what can I do" question
 * is one call instead of three.
 */
export async function handleLapObserve(req: Request, deps: LapObserveDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const hello = deps.registry.getHello(auth.tid)
  if (!hello) return json({ error: { code: 'paused' } }, 503)

  let dynamic: {
    state: unknown
    actions: LapActionsResponse['actions']
    context: AgentContext | null
  }
  try {
    dynamic = (await deps.registry.rpc(auth.tid, 'observe', {})) as typeof dynamic
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string }
    const code = err.code ?? 'internal'
    const status = code === 'paused' ? 503 : code === 'timeout' ? 504 : 500
    return json({ error: { code, detail: err.detail } }, status)
  }

  const description: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages: hello.msgSchema as Record<string, MessageSchemaEntry>,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  const out: LapObserveResponse = {
    state: dynamic.state,
    actions: dynamic.actions,
    description,
    context: dynamic.context,
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { tool: 'observe' },
  })
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
