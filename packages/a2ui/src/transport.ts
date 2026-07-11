/**
 * Transport adapters — connect a `mountA2ui` renderer to a live message channel.
 *
 * A2UI is transport-agnostic; this is the shared seam every transport rides on:
 * pump inbound envelopes into `apply()`, push outbound actions to the channel.
 * `webSocketTransport` is the first concrete adapter; A2A / AG-UI / MCP drop onto
 * the same `A2uiTransport` interface.
 */

import { mountA2ui, type A2uiActionEvent, type A2uiHandle, type A2uiOptions } from './index.js'
import type { ServerToClientEnvelope } from './protocol.js'

/** A bidirectional A2UI channel: deliver server→client envelopes, accept actions. */
export interface A2uiTransport {
  /** Subscribe to inbound server→client envelopes. Returns an unsubscribe. */
  onEnvelope(handler: (envelope: ServerToClientEnvelope) => void): () => void
  /** Send a client→server action to the channel. */
  sendAction(event: A2uiActionEvent): void
}

/**
 * Mount an A2UI renderer wired to a transport: inbound envelopes flow into the
 * renderer, user actions flow out to the transport (plus any `onAction` you
 * pass). Disposing the returned handle also unsubscribes from the transport.
 */
export function connectA2ui(
  container: Element,
  transport: A2uiTransport,
  options: A2uiOptions = {},
): A2uiHandle {
  const handle = mountA2ui(container, {
    ...options,
    onAction: (event) => {
      options.onAction?.(event)
      transport.sendAction(event)
    },
  })
  const unsubscribe = transport.onEnvelope((envelope) => handle.apply(envelope))
  return {
    apply: handle.apply,
    getState: handle.getState,
    capabilities: handle.capabilities,
    subscribe: handle.subscribe,
    dispose: () => {
      unsubscribe()
      handle.dispose()
    },
  }
}

/** The minimal WebSocket surface `webSocketTransport` needs (mockable in tests). */
export interface WebSocketLike {
  send(data: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

/** Options for `webSocketTransport`. */
export interface WebSocketTransportOptions {
  /**
   * Called when an inbound frame can't be used — unparseable JSON, or a value
   * that isn't an envelope object. Defaults to `console.warn`; pass your own to
   * route these somewhere else (or a no-op to intentionally ignore them).
   * Frames are never dropped *silently*.
   */
  onError?: (error: Error, rawData: unknown) => void
}

/**
 * A WebSocket A2UI transport. Inbound frames are parsed as an envelope or an
 * array of envelopes; outbound actions are sent as `{ action }` JSON frames.
 * Unparseable or non-envelope frames are reported via `options.onError`
 * (default: `console.warn`) rather than dropped silently.
 */
export function webSocketTransport(
  socket: WebSocketLike,
  options: WebSocketTransportOptions = {},
): A2uiTransport {
  const onError =
    options.onError ??
    ((error: Error, rawData: unknown) =>
      console.warn(`[a2ui] dropped WebSocket frame: ${error.message}`, rawData))
  return {
    onEnvelope(handler) {
      const listener = (event: { data: unknown }): void => {
        let parsed: unknown
        try {
          parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        } catch (e) {
          onError(e instanceof Error ? e : new Error(String(e)), event.data)
          return
        }
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const envelope of list) {
          if (envelope === null || typeof envelope !== 'object') {
            onError(new Error('frame is not an envelope object'), envelope)
            continue
          }
          handler(envelope as ServerToClientEnvelope)
        }
      }
      socket.addEventListener('message', listener)
      return () => socket.removeEventListener('message', listener)
    },
    sendAction(event) {
      socket.send(JSON.stringify({ action: event }))
    },
  }
}
