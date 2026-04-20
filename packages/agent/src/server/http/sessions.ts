import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AgentSession, SessionsResponse } from '../../protocol.js'

export type SessionsDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
}

export async function handleSessions(req: Request, deps: SessionsDeps): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: { code: 'method-not-allowed' } }, 405)
  }
  const uid = await deps.identityResolver(req)
  if (uid === null) {
    return json({ sessions: [] } satisfies SessionsResponse, 200)
  }
  const records = await deps.tokenStore.listByIdentity(uid)
  const sessions: AgentSession[] = records
    .filter((r) => r.status === 'active' || r.status === 'pending-resume')
    .map((r) => ({
      tid: r.tid,
      label: r.label ?? '(unknown)',
      status: r.status as 'active' | 'pending-resume',
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
    }))
  return json({ sessions } satisfies SessionsResponse, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
