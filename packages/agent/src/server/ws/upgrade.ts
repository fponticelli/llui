import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { TLSSocket } from 'node:tls'
import type { PairingConnection } from './pairing-registry.js'
import type { AgentCoreHandle } from '../core.js'
import { checkWsOrigin, composeSelfOrigin } from './origin.js'
import type { ClientFrame, ServerFrame } from '../../protocol.js'

export type UpgradeDeps = {
  /**
   * The core's connection-accept path. Routing through it (rather than
   * a bespoke verify block here) keeps the auth story uniform across the
   * Node, Cloudflare, and Deno upgrade surfaces — revoke / sliding-TTL /
   * pending-resume grace are all enforced in exactly one place.
   */
  acceptConnection: AgentCoreHandle['acceptConnection']
  /**
   * Optional CSWSH origin allowlist. When set, the upgrade's `Origin`
   * must be a member; when unset, same-origin is required. A browser
   * always sends `Origin`; a non-browser client sends none and is
   * allowed (it cannot be a CSWSH vector). See {@link checkWsOrigin}.
   */
  corsOrigins?: readonly string[]
}

/** Reject the raw upgrade socket with a bare HTTP status (RFC 6455 §4.4). */
function rejectSocket(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`)
  socket.destroy()
}

/** Derive the server's own origin from the upgrade request. */
function selfOriginOf(req: IncomingMessage): string {
  const firstHeader = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v
  return composeSelfOrigin({
    forwardedProto: firstHeader(req.headers['x-forwarded-proto']),
    fallbackProto: (req.socket as TLSSocket).encrypted ? 'https' : 'http',
    forwardedHost: firstHeader(req.headers['x-forwarded-host']),
    fallbackHost: req.headers.host ?? '',
  })
}

/**
 * Returns a handler for `server.on('upgrade', ...)`. Validates the
 * request path, the `Origin` (CSWSH defense), and the bearer token,
 * then hands the socket to the core's `acceptConnection`. Unauthorized
 * paths/origins/tokens get a bare HTTP error response on the raw socket
 * (per RFC 6455 the response must be sent before the socket is torn
 * down).
 *
 * Spec §10.2, §10.4.
 */
export function createWsUpgradeHandler(deps: UpgradeDeps) {
  const wss = new WebSocketServer({ noServer: true })

  return async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    // Path check
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/agent/ws') {
      rejectSocket(socket, '404 Not Found')
      return
    }

    // CSWSH defense: a WebSocket handshake is a cross-origin GET not
    // subject to CORS, so we validate `Origin` ourselves before doing
    // any work bound to the victim's ambient credentials.
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const originCheck = checkWsOrigin(originHeader, selfOriginOf(req), deps.corsOrigins)
    if (!originCheck.ok) {
      rejectSocket(socket, '403 Forbidden')
      return
    }

    // Token — try query string first (browsers can't set arbitrary
    // headers on WebSocket construction), then Authorization header.
    let token = url.searchParams.get('token')
    if (!token) {
      const auth = req.headers['authorization']
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice('Bearer '.length)
      }
    }
    if (!token) {
      rejectSocket(socket, '401 Unauthorized')
      return
    }

    // Complete the handshake, then validate the token through the
    // shared accept path. Like the Cloudflare/Deno handlers, token
    // *validity* is checked post-upgrade (acceptConnection couples
    // verify + register); the cheap pre-checks above reject before we
    // ever upgrade.
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const conn: PairingConnection = {
        send(frame: ServerFrame) {
          ws.send(JSON.stringify(frame))
        },
        onFrame(handler) {
          ws.on('message', (data: Buffer | string) => {
            const raw = typeof data === 'string' ? data : data.toString('utf8')
            try {
              const parsed = JSON.parse(raw) as ClientFrame
              handler(parsed)
            } catch {
              // Ignore malformed frames.
            }
          })
        },
        onClose(handler) {
          // Registration happens after the async `acceptConnection`
          // resolves, so the socket can already be closed by the time
          // the registry attaches this handler — in which case the
          // 'close' event has passed and would never fire. Detect that
          // and run the handler immediately so the pairing is still torn
          // down (no stale registration left behind).
          if (ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED) {
            handler()
            return
          }
          ws.on('close', handler)
        },
        close() {
          ws.close()
        },
      }

      void deps.acceptConnection(token, conn).then((result) => {
        if (!result.ok) ws.close()
      })
    })
  }
}
