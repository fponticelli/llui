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
 * underlying primitives directly.
 *
 * As of 0.0.35 the token format is opaque (random, not signed), so we
 * can't recover `tid` from the token alone. The caller passes a
 * `resolveTid` callback — typically `(token) => stub.fetch(...)` to
 * the root DO's token-resolution endpoint — that turns a bearer into
 * its tid via the shared token store. Callers that don't shard by
 * tid can pass `() => Promise.resolve(rootName)` to route everything
 * through the root DO.
 */
export async function routeToAgentDO(
  req: Request,
  namespace: MinimalDurableObjectNamespace,
  resolveTid: (token: string) => Promise<string | null>,
  opts: { rootName?: string; mcpPath?: string } = {},
): Promise<Response> {
  const rootName = opts.rootName ?? '__root'
  const mcpPath = opts.mcpPath ?? '/agent/mcp'
  const url = new URL(req.url)
  const path = url.pathname

  // Non-LAP / non-WS management endpoints (mint, resume, sessions,
  // revoke, mcp) — there's no per-tid routing and no bearer token
  // required; use the root DO which owns the shared token store +
  // identity resolver. MCP auth happens within the protocol via
  // connect_session({token}), so the endpoint itself must be reachable
  // without a pre-existing bearer.
  if (
    path === '/agent/mint' ||
    path === '/agent/revoke' ||
    path === '/agent/resume/list' ||
    path === '/agent/resume/claim' ||
    path === '/agent/sessions' ||
    path.startsWith(mcpPath)
  ) {
    const stub = namespace.get(namespace.idFromName(rootName))
    return stub.fetch(req)
  }

  // Token-bearing routes (LAP + WS upgrade) — route by tid.
  const token = extractTokenFromRequest(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  const tid = await resolveTid(token)
  if (!tid) return new Response('Unauthorized', { status: 401 })

  const stub = namespace.get(namespace.idFromName(tid))
  return stub.fetch(req)
}

function extractTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  const url = new URL(req.url)
  const q = url.searchParams.get('token')
  return q
}
