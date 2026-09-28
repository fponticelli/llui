import type { PairingConnection } from '../ws/pairing-registry.js'
import { parseClientFrame, type ClientFrame, type ServerFrame } from '../../protocol.js'

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
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      // Ignore malformed JSON — one bad frame shouldn't tear down the pairing.
      return
    }
    // Validate the frame envelope at the boundary, exactly as the Node
    // adapter (`../ws/upgrade.ts`) does: an unchecked `as ClientFrame` would
    // let a malformed / hostile frame reach dispatch with wrong-typed
    // correlation fields. Invalid frames are dropped (there is no
    // client-bound rpc-error channel server-side).
    const frame = parseClientFrame(json)
    if (!frame) {
      console.warn('[llui-agent] dropping invalid client frame')
      return
    }
    if (frameHandler) frameHandler(frame)
    else buffer.push(frame)
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
