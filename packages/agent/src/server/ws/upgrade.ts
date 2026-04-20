import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WsPairingRegistry, PairingConnection } from './pairing-registry.js'
import type { TokenStore } from '../token-store.js'
import type { AuditSink } from '../audit.js'
import { verifyToken } from '../token.js'
import type { ClientFrame, ServerFrame } from '../../protocol.js'

export type UpgradeDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

/**
 * Returns a handler for `server.on('upgrade', ...)`. Validates the token
 * from the query string, attaches to the registry, wires frame/close
 * routing. Unauthorized paths/tokens get a bare HTTP error response on
 * the raw socket (per RFC 6455 the response must be sent before the
 * socket is torn down).
 *
 * Spec §10.2, §10.4.
 */
export function createWsUpgradeHandler(deps: UpgradeDeps) {
  const wss = new WebSocketServer({ noServer: true })
  const now = deps.now ?? (() => Date.now())

  return (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Path check
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/agent/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    // Token — try query string first, then Authorization header
    let token = url.searchParams.get('token')
    if (!token) {
      const auth = req.headers['authorization']
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        token = auth.slice('Bearer '.length)
      }
    }
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const verified = verifyToken(token, deps.signingKey)
    if (verified.kind !== 'ok') {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const { tid } = verified.payload

    // Perform upgrade, wire to registry
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
          ws.on('close', handler)
        },
        close() {
          ws.close()
        },
      }
      deps.registry.register(tid, conn)

      // Store touch; audit
      void deps.tokenStore.touch(tid, now())
      void deps.auditSink.write({
        at: now(),
        tid,
        uid: null,
        event: 'claim',
        detail: { transport: 'ws' },
      })
    })
  }
}
