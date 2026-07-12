import type { Deps, InternalSend, Runner } from '../core.js'
import type { WebSocketEffect, WebSocketSendEffect } from '../types.js'

function runWebSocket(
  effect: WebSocketEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): void {
  const { websockets } = deps.registry
  // Replace any existing websocket on the same key. Detach its handlers FIRST so
  // its async `onclose` can neither dispatch a spurious app `onClose` nor delete
  // the replacement from the registry (the replacement-race bug).
  const existing = websockets.get(effect.key)
  if (existing) {
    existing.onopen = null
    existing.onmessage = null
    existing.onclose = null
    existing.onerror = null
    existing.close()
  }

  const ws = effect.protocols
    ? new WebSocket(effect.url, effect.protocols)
    : new WebSocket(effect.url)
  websockets.set(effect.key, ws)

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
    // Only clear the registry slot if it still points at THIS socket — a
    // replacement may already own the key.
    if (websockets.get(effect.key) === ws) websockets.delete(effect.key)
    if (effect.onClose) send(effect.onClose(e.code, e.reason))
  }

  ws.onerror = () => {
    if (effect.onError) send(effect.onError())
  }

  signal.addEventListener(
    'abort',
    () => {
      ws.onclose = null // unmount — don't dispatch app onClose
      ws.close()
      if (websockets.get(effect.key) === ws) websockets.delete(effect.key)
    },
    { once: true },
  )
}

function runWsSend(effect: WebSocketSendEffect, deps: Deps): void {
  const ws = deps.registry.websockets.get(effect.key)
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(typeof effect.data === 'string' ? effect.data : JSON.stringify(effect.data))
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
