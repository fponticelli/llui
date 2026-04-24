import type { AgentCoreHandle } from '../core.js'
import { createWHATWGPairingConnection } from './adapter.js'

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

/**
 * Cloudflare Workers handler. Accepts a WebSocket upgrade using
 * `WebSocketPair`, validates the token via
 * `agent.acceptConnection`, and returns the 101 upgrade Response.
 *
 * Usage:
 * ```ts
 * const agent = createLluiAgentCore({ signingKey: env.AGENT_KEY })
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
  const token = extractToken(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  // `WebSocketPair` is a Cloudflare Workers global. We reference it
  // through `globalThis` so importing this module in non-CF runtimes
  // (e.g. during type-checking on Node) doesn't crash.
  const Pair = (
    globalThis as unknown as { WebSocketPair?: new () => { 0: WebSocket; 1: WebSocket } }
  ).WebSocketPair
  if (!Pair) {
    return new Response('WebSocketPair unavailable in this runtime', { status: 501 })
  }
  const pair = new Pair()
  const client = pair[0]
  const server = pair[1]!
  // `accept()` on the server half is Cloudflare-specific — it tells
  // the runtime the Worker will handle the WebSocket itself.
  ;(server as unknown as { accept: () => void }).accept()

  const conn = createWHATWGPairingConnection(server)
  const result = await agent.acceptConnection(token, conn)
  if (!result.ok) {
    conn.close()
    return new Response(result.code, { status: result.status })
  }

  // `webSocket` on ResponseInit is Cloudflare-specific; cast to satisfy
  // the standard lib types.
  return new Response(null, { status: 101, webSocket: client } as ResponseInit & {
    webSocket: WebSocket
  })
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
  const token = extractToken(req)
  if (!token) return new Response('Unauthorized', { status: 401 })

  const Deno_ = (
    globalThis as unknown as {
      Deno?: {
        upgradeWebSocket: (req: Request) => { socket: WebSocket; response: Response }
      }
    }
  ).Deno
  if (!Deno_) {
    return new Response('Deno.upgradeWebSocket unavailable in this runtime', { status: 501 })
  }

  const { socket, response } = Deno_.upgradeWebSocket(req)
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
