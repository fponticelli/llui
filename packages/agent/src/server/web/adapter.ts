import type { PairingConnection } from '../ws/pairing-registry.js'
import type { ClientFrame, ServerFrame } from '../../protocol.js'

/**
 * Wrap a WHATWG `WebSocket` in a `PairingConnection`. This is the
 * common denominator across Cloudflare Workers (`WebSocketPair`
 * server half), Deno (`Deno.upgradeWebSocket().socket`), Bun's
 * upgraded socket, and any other runtime that exposes a
 * standards-compliant WebSocket object.
 *
 * The input type is intentionally the browser/global `WebSocket`
 * interface — *not* the Node `ws` library's variant, which uses an
 * EventEmitter API (`on('message', ...)`) rather than
 * `addEventListener('message', ...)`. Use `./node/upgrade.ts` for
 * the `ws` library path.
 */
export function createWHATWGPairingConnection(socket: WebSocket): PairingConnection {
  return {
    send(frame: ServerFrame) {
      socket.send(JSON.stringify(frame))
    },
    onFrame(handler) {
      socket.addEventListener('message', (ev) => {
        const data = ev.data
        const raw = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)
        try {
          const parsed = JSON.parse(raw) as ClientFrame
          handler(parsed)
        } catch {
          // Ignore malformed frames — one bad frame shouldn't tear down the pairing.
        }
      })
    },
    onClose(handler) {
      socket.addEventListener('close', () => handler())
    },
    close() {
      try {
        socket.close()
      } catch {
        // Some runtimes throw if you close twice; swallow.
      }
    },
  }
}
