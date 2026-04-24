import { verifyToken } from '../token.js'

/**
 * Minimal DurableObjectNamespace surface we need — `idFromName` +
 * `get` returning a `Stub` with `fetch(req)`. Kept structural so we
 * don't depend on `@cloudflare/workers-types` (the user's project has
 * them; we shouldn't duplicate).
 */
export interface MinimalDurableObjectNamespace {
  idFromName(name: string): MinimalDurableObjectId
  get(id: MinimalDurableObjectId): MinimalDurableObjectStub
}
export interface MinimalDurableObjectId {
  // Opaque, but DO ids are passed back into `namespace.get()`.
  readonly name?: string
}
export interface MinimalDurableObjectStub {
  fetch(req: Request): Promise<Response>
}

/**
 * Route an incoming Worker `fetch` request to the Durable Object
 * that owns its `tid`.
 *
 * The token travels in three places depending on the route:
 *   - LAP HTTP calls: `Authorization: Bearer <token>` header
 *   - Mint / resume HTTP calls: no token (identity resolver runs
 *     inside the DO via the LAP router; we route by origin or a
 *     special `/agent/mint` path — see below)
 *   - WebSocket upgrade: `?token=<token>` in the URL
 *
 * Requests that don't carry a tid (mint, resume-list, sessions) are
 * routed to a "root" DO named `__root`, which handles identity /
 * token store operations centrally. LAP and WS calls route to the
 * per-tid DO so the pairing state stays local.
 *
 * This is the recommended entry for Cloudflare Workers deployments;
 * users who need custom routing can write their own and call the
 * underlying primitives (`verifyToken`, `namespace.get`, etc).
 */
export async function routeToAgentDO(
  req: Request,
  namespace: MinimalDurableObjectNamespace,
  signingKey: string | Uint8Array,
  opts: { rootName?: string } = {},
): Promise<Response> {
  const rootName = opts.rootName ?? '__root'
  const url = new URL(req.url)
  const path = url.pathname

  // Non-LAP / non-WS management endpoints (mint, resume, sessions,
  // revoke) — there's no per-tid routing; use the root DO which owns
  // the shared token store + identity resolver.
  if (
    path === '/agent/mint' ||
    path === '/agent/revoke' ||
    path === '/agent/resume/list' ||
    path === '/agent/resume/claim' ||
    path === '/agent/sessions'
  ) {
    const stub = namespace.get(namespace.idFromName(rootName))
    return stub.fetch(req)
  }

  // Token-bearing routes (LAP + WS upgrade) — route by tid.
  const token = extractTokenFromRequest(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  const verified = await verifyToken(token, signingKey)
  if (verified.kind !== 'ok') return new Response('Unauthorized', { status: 401 })

  const stub = namespace.get(namespace.idFromName(verified.payload.tid))
  return stub.fetch(req)
}

function extractTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  const url = new URL(req.url)
  const q = url.searchParams.get('token')
  return q
}
