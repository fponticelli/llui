import type { Deps, InternalSend, Runner, WebSocketEntry } from '../core.js'
import type { WebSocketEffect, WebSocketSendEffect } from '../types.js'

function runWebSocket(
  effect: WebSocketEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): void {
  const { websockets } = deps.registry

  // A dead scope opens nothing. `addEventListener('abort', …)` on an ALREADY
  // aborted signal never fires, so a socket opened here would have nothing left
  // to close it — and it could never dispatch anyway.
  if (signal.aborted) return

  // Supersede any existing socket on this key — its handlers, the socket itself
  // AND its abort listener. Detaching the handlers is what stops the old
  // socket's async `onclose` dispatching a spurious app `onClose` or evicting
  // the replacement from the registry (the replacement-race bug).
  websockets.get(effect.key)?.close()

  const ws = effect.protocols
    ? new WebSocket(effect.url, effect.protocols)
    : new WebSocket(effect.url)

  /**
   * Give the mount back everything this socket is holding, and stop it talking.
   * Idempotent: `close()` on a closed socket is a no-op, `removeEventListener`
   * with an unregistered listener is a no-op, and the slot is only dropped while
   * it is still ours — a replacement may already own the key (issue #83).
   */
  const close = (): void => {
    ws.onopen = null
    ws.onmessage = null
    ws.onclose = null
    ws.onerror = null
    ws.close()
    signal.removeEventListener('abort', close)
    if (websockets.get(effect.key) === entry) websockets.delete(effect.key)
  }

  const entry: WebSocketEntry = { socket: ws, close }
  websockets.set(effect.key, entry)

  ws.onopen = () => {
    if (effect.onOpen) send(effect.onOpen())
  }

  ws.onmessage = (e: MessageEvent) => {
    let data: unknown
    try {
      data = JSON.parse(e.data as string)
    } catch {
      data = e.data
    }
    send(effect.onMessage(data))
  }

  ws.onclose = (e: CloseEvent) => {
    // The socket died on its own. The retirement is the same one — including
    // the abort listener, which would otherwise wait for an abort that only
    // comes at unmount. The app still hears about it afterwards.
    close()
    if (effect.onClose) send(effect.onClose(e.code, e.reason))
  }

  ws.onerror = () => {
    if (effect.onError) send(effect.onError())
  }

  // Unmount closes the socket WITHOUT dispatching the app's `onClose` — `close()`
  // detaches the handler first. Self-removing, so `{ once: true }` is belt and
  // braces rather than the only thing retiring it.
  signal.addEventListener('abort', close, { once: true })
}

function runWsSend(effect: WebSocketSendEffect, deps: Deps): void {
  const entry = deps.registry.websockets.get(effect.key)
  if (!entry || entry.socket.readyState !== WebSocket.OPEN) return
  entry.socket.send(typeof effect.data === 'string' ? effect.data : JSON.stringify(effect.data))
}

export const websocketRunner: Runner = {
  types: ['websocket'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runWebSocket(effect as WebSocketEffect, send, signal, deps)
  },
}

export const wsSendRunner: Runner = {
  types: ['ws-send'],
  completesWithoutDispatch: true,
  run(effect, _send, _signal, deps) {
    runWsSend(effect as WebSocketSendEffect, deps)
  },
}
