import type { AgentCoreHandle } from '../core.js'
import { createWHATWGPairingConnection, type WhatwgSocket } from './adapter.js'
import { checkWsOrigin, composeSelfOrigin } from '../ws/origin.js'

/**
 * The server's own origin for the same-origin CSWSH fallback. Behind a
 * TLS-terminating proxy the runtime sees `http://…` while the browser's
 * `Origin` is `https://…`, so honor `x-forwarded-proto`/`x-forwarded-host`
 * (mirroring the Node adapter via the shared {@link composeSelfOrigin})
 * before falling back to the request URL — otherwise every legitimate
 * proxied upgrade would 403 unless the operator sets `corsOrigins`.
 */
function selfOriginOf(req: Request): string {
  const url = new URL(req.url)
  return composeSelfOrigin({
    forwardedProto: req.headers.get('x-forwarded-proto'),
    fallbackProto: url.protocol.replace(/:$/, ''),
    forwardedHost: req.headers.get('x-forwarded-host'),
    fallbackHost: url.host,
  })
}

/**
 * Extract the bearer token from a LAP WebSocket upgrade request.
 * Accepts the token on either `?token=` or `Authorization: Bearer` —
 * query-string is the common pattern because browsers can't set
 * arbitrary headers on WebSocket construction.
 */
export function extractToken(req: Request): string | null {
  const url = new URL(req.url)
  const q = url.searchParams.get('token')
  if (q) return q
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  return null
}

// ── Platform globals ─────────────────────────────────────────────────────────
//
// `WebSocketPair` (Cloudflare Workers) and `Deno.upgradeWebSocket` (Deno) are
// globals of runtimes this package is not type-checked against, so they are
// read off `globalThis` as `unknown` and CHECKED here. A missing global or one
// of an unexpected shape becomes a 501, never a TypeError out of the handler.
// A function's parameter types are not observable at runtime, so a socket is
// checked for every member the adapter calls being a function — the most any
// runtime check of a callable can establish.

function isObject(v: unknown): v is object {
  return (typeof v === 'object' && v !== null) || typeof v === 'function'
}

function isWhatwgSocket(v: unknown): v is WhatwgSocket {
  return (
    isObject(v) &&
    'send' in v &&
    typeof v.send === 'function' &&
    'close' in v &&
    typeof v.close === 'function' &&
    'addEventListener' in v &&
    typeof v.addEventListener === 'function'
  )
}

/** Cloudflare's server half: a WHATWG socket plus the Workers-only `accept()`,
 * which tells the runtime the Worker will handle the WebSocket itself. */
interface CloudflareServerSocket extends WhatwgSocket {
  accept(): void
}

function isCloudflareServerSocket(v: unknown): v is CloudflareServerSocket {
  return isWhatwgSocket(v) && 'accept' in v && typeof v.accept === 'function'
}

/** A fresh Cloudflare `WebSocketPair` as `[client, server]`, `'absent'` when the
 * runtime has no such global, or `'malformed'` when it yields something else. */
function newCloudflarePair():
  | { readonly client: object; readonly server: CloudflareServerSocket }
  | 'absent'
  | 'malformed' {
  const g: object = globalThis
  if (!('WebSocketPair' in g)) return 'absent'
  const Pair = g.WebSocketPair
  if (typeof Pair !== 'function') return 'malformed'
  const pair: unknown = Reflect.construct(Pair, [])
  if (!isObject(pair) || !('0' in pair) || !('1' in pair)) return 'malformed'
  const client = pair[0]
  const server = pair[1]
  if (!isObject(client) || !isCloudflareServerSocket(server)) return 'malformed'
  return { client, server }
}

/** `Deno.upgradeWebSocket(req)` as `{ socket, response }`, `'absent'` when the
 * runtime has no such global, or `'malformed'` when it yields something else. */
function denoUpgrade(
  req: Request,
): { readonly socket: WhatwgSocket; readonly response: Response } | 'absent' | 'malformed' {
  const g: object = globalThis
  if (!('Deno' in g)) return 'absent'
  const deno = g.Deno
  if (!isObject(deno) || !('upgradeWebSocket' in deno)) return 'absent'
  const upgrade = deno.upgradeWebSocket
  if (typeof upgrade !== 'function') return 'malformed'
  const result: unknown = Reflect.apply(upgrade, deno, [req])
  if (!isObject(result) || !('socket' in result) || !('response' in result)) return 'malformed'
  const { socket, response } = result
  if (!isWhatwgSocket(socket) || !(response instanceof Response)) return 'malformed'
  return { socket, response }
}

/**
 * Cloudflare Workers handler. Accepts a WebSocket upgrade using
 * `WebSocketPair`, validates the token via
 * `agent.acceptConnection`, and returns the 101 upgrade Response.
 *
 * Usage:
 * ```ts
 * const agent = createLluiAgentCore()
 * export default {
 *   async fetch(req, env) {
 *     const url = new URL(req.url)
 *     if (url.pathname === '/agent/ws') return handleCloudflareUpgrade(req, agent)
 *     return (await agent.router(req)) ?? new Response('Not Found', { status: 404 })
 *   },
 * }
 * ```
 */
export async function handleCloudflareUpgrade(
  req: Request,
  agent: AgentCoreHandle,
): Promise<Response> {
  if (req.headers.get('upgrade') !== 'websocket') {
    return new Response('Expected upgrade: websocket', { status: 426 })
  }
  // CSWSH defense — see checkWsOrigin. Must run before any work bound to
  // the victim's ambient credentials.
  const originCheck = checkWsOrigin(
    req.headers.get('origin'),
    selfOriginOf(req),
    agent.allowedOrigins,
  )
  if (!originCheck.ok) return new Response('Forbidden', { status: 403 })
  const token = extractToken(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  // `WebSocketPair` is a Cloudflare Workers global, read through `globalThis`
  // so importing this module in non-CF runtimes (e.g. Node) doesn't crash.
  const pair = newCloudflarePair()
  if (pair === 'absent') {
    return new Response('WebSocketPair unavailable in this runtime', { status: 501 })
  }
  if (pair === 'malformed') {
    return new Response('WebSocketPair returned an unexpected shape', { status: 501 })
  }
  const { client, server } = pair
  server.accept()

  const conn = createWHATWGPairingConnection(server)
  const result = await agent.acceptConnection(token, conn)
  if (!result.ok) {
    conn.close()
    return new Response(result.code, { status: result.status })
  }

  // `webSocket` on ResponseInit is Cloudflare-specific; the standard lib's
  // `ResponseInit` does not declare it, so the init is typed as the widening.
  const init: ResponseInit & { readonly webSocket: object } = { status: 101, webSocket: client }
  return new Response(null, init)
}

/**
 * Deno handler. Uses `Deno.upgradeWebSocket(req)` to produce the
 * response + socket pair, then plugs the socket into the registry.
 *
 * Usage:
 * ```ts
 * Deno.serve(async (req) => {
 *   const url = new URL(req.url)
 *   if (url.pathname === '/agent/ws') return handleDenoUpgrade(req, agent)
 *   return (await agent.router(req)) ?? new Response('Not Found', { status: 404 })
 * })
 * ```
 */
export async function handleDenoUpgrade(req: Request, agent: AgentCoreHandle): Promise<Response> {
  // CSWSH defense — see checkWsOrigin.
  const originCheck = checkWsOrigin(
    req.headers.get('origin'),
    selfOriginOf(req),
    agent.allowedOrigins,
  )
  if (!originCheck.ok) return new Response('Forbidden', { status: 403 })
  const token = extractToken(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  const upgraded = denoUpgrade(req)
  if (upgraded === 'absent') {
    return new Response('Deno.upgradeWebSocket unavailable in this runtime', { status: 501 })
  }
  if (upgraded === 'malformed') {
    return new Response('Deno.upgradeWebSocket returned an unexpected shape', { status: 501 })
  }
  const { socket, response } = upgraded
  const conn = createWHATWGPairingConnection(socket)

  // Deno opens the socket asynchronously; validate the token first,
  // then register on `open` so frames aren't missed.
  socket.addEventListener(
    'open',
    () => {
      void agent.acceptConnection(token, conn).then((result) => {
        if (!result.ok) conn.close()
      })
    },
    { once: true },
  )

  return response
}
