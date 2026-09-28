import type { PairingConnection } from '../ws/pairing-registry.js'
import type { ClientFrame, ServerFrame } from '../../protocol.js'

/**
 * The part of a WHATWG `WebSocket` the web adapters use. The global `WebSocket`
 * satisfies it structurally; so does a Cloudflare `WebSocketPair` half or a
 * Deno upgraded socket, without either being asserted to be a DOM `WebSocket`.
 * A message's `data` is `unknown` because the platform types it `any`: the
 * adapter narrows it (string, `ArrayBuffer`, or a byte view) before decoding.
 */
export interface WhatwgSocket {
  send(data: string): void
  close(): void
  addEventListener(type: 'message', listener: (ev: { readonly data: unknown }) => void): void
  addEventListener(type: 'close', listener: () => void): void
  /** Used by the Deno upgrade handler, which registers the pairing on `open`. */
  addEventListener(type: 'open', listener: () => void, options?: { readonly once?: boolean }): void
}

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
export function createWHATWGPairingConnection(socket: WhatwgSocket): PairingConnection {
  // Attach the message + close listeners NOW (at socket-accept time), not
  // when the registry later calls onFrame/onClose. `register()` runs only
  // after the async `acceptConnection` (token verify + store lookup, which
  // may hit a non-in-memory store) resolves — and the browser sends its
  // `hello` the instant the socket opens. Buffering here means that early
  // hello (and any other pre-registration frame) is preserved and flushed
  // into the handler once registration completes, instead of being lost.
  const buffer: ClientFrame[] = []
  let frameHandler: ((f: ClientFrame) => void) | null = null
  let closeHandler: (() => void) | null = null
  let closed = false

  socket.addEventListener('message', (ev) => {
    const data = ev.data
    const raw =
      typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
          ? new TextDecoder().decode(data)
          : null
    // Neither text nor bytes (e.g. a `Blob` under a non-default binaryType) —
    // not a frame this protocol sends.
    if (raw === null) return
    let parsed: ClientFrame
    try {
      parsed = JSON.parse(raw) as ClientFrame
    } catch {
      // Ignore malformed frames — one bad frame shouldn't tear down the pairing.
      return
    }
    if (frameHandler) frameHandler(parsed)
    else buffer.push(parsed)
  })
  socket.addEventListener('close', () => {
    closed = true
    closeHandler?.()
  })

  return {
    send(frame: ServerFrame) {
      socket.send(JSON.stringify(frame))
    },
    onFrame(handler) {
      frameHandler = handler
      // Flush anything received before registration (the hello frame).
      const pending = buffer.splice(0, buffer.length)
      for (const f of pending) handler(f)
    },
    onClose(handler) {
      // If the socket already closed before registration wired this
      // handler, fire immediately so the pairing is still torn down.
      if (closed) {
        handler()
        return
      }
      closeHandler = handler
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
