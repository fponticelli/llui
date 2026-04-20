import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import { signToken } from '../token.js'
import type {
  ResumeListRequest,
  ResumeListResponse,
  ResumeClaimRequest,
  ResumeClaimResponse,
  TokenPayload,
  AgentSession,
} from '../../protocol.js'

export type ResumeDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  signingKey?: string | Uint8Array
  now?: () => number
  hardExpiryMs?: number
}

export async function handleResumeList(req: Request, deps: ResumeDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()
  const body = (await req.json().catch(() => null)) as ResumeListRequest | null
  if (!body || !Array.isArray(body.tids)) return badRequest()

  const uid = await deps.identityResolver(req)
  const nowMs = (deps.now ?? (() => Date.now()))()
  const out: AgentSession[] = []
  for (const tid of body.tids) {
    const rec = await deps.tokenStore.findByTid(tid)
    if (!rec) continue
    if (rec.uid !== uid) continue
    if (rec.status !== 'pending-resume') continue
    if (rec.pendingResumeUntil === null || rec.pendingResumeUntil < nowMs) continue
    out.push({
      tid: rec.tid,
      label: rec.label ?? '(unknown)',
      status: 'pending-resume',
      createdAt: rec.createdAt,
      lastSeenAt: rec.lastSeenAt,
    })
  }

  const payload: ResumeListResponse = { sessions: out }
  return jsonResponse(payload, 200)
}

export async function handleResumeClaim(req: Request, deps: ResumeDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()
  if (!deps.signingKey) return new Response(null, { status: 500 })

  const body = (await req.json().catch(() => null)) as ResumeClaimRequest | null
  if (!body || typeof body.tid !== 'string') return badRequest()

  const uid = await deps.identityResolver(req)
  const rec = await deps.tokenStore.findByTid(body.tid)
  if (!rec) return forbidden()
  if (rec.uid !== uid) return forbidden()
  if (rec.status !== 'pending-resume') return forbidden()

  const origin = new URL(req.url).origin
  if (rec.origin !== origin) return forbidden()

  const nowMs = (deps.now ?? (() => Date.now()))()
  const hardExpiryMs = deps.hardExpiryMs ?? 24 * 60 * 60 * 1000
  const iat = Math.floor(nowMs / 1000)
  const exp = Math.floor((nowMs + hardExpiryMs) / 1000)
  const payload: TokenPayload = { tid: rec.tid, iat, exp, scope: 'agent' }
  const token = signToken(payload, deps.signingKey)

  await deps.tokenStore.markActive(rec.tid, rec.label ?? '(resumed)', nowMs)

  await deps.auditSink.write({
    at: nowMs,
    tid: rec.tid,
    uid: rec.uid,
    event: 'claim',
    detail: { origin },
  })

  const wsUrl = toWsUrl(origin) + '/agent/ws'
  const out: ResumeClaimResponse = { token, wsUrl }
  return jsonResponse(out, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: { code: 'method-not-allowed' } }, 405)
}

function badRequest(): Response {
  return jsonResponse({ error: { code: 'invalid' } }, 400)
}

function forbidden(): Response {
  return jsonResponse({ error: { code: 'revoked' } }, 403)
}

function toWsUrl(httpOrigin: string): string {
  return httpOrigin.startsWith('https://')
    ? 'wss://' + httpOrigin.slice('https://'.length)
    : 'ws://' + httpOrigin.slice('http://'.length)
}
