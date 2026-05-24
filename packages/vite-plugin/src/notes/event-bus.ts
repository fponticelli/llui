// Transport-agnostic SSE event bus. Subscribers are role-tagged
// (hud / mcp / viewer); only `hud` subscribers receive `capture-request`
// events (per 02-middleware.md §"Identifying HUD subscribers"). The HTTP
// layer wires each SSE response to a subscription via `subscribe()` and
// disposes via the returned unsubscribe callback.

import type { ServerEvent, SseRole } from './types.js'

export type SseEventListener = (event: ServerEvent) => void

interface Entry {
  role: SseRole
  listener: SseEventListener
}

export interface EventBus {
  subscribe(role: SseRole, listener: SseEventListener): () => void
  broadcast(event: ServerEvent): void
  countByRole(role: SseRole): number
}

/** Returns whether this event should reach a subscriber of the given role. */
function shouldDeliver(event: ServerEvent, role: SseRole): boolean {
  if (event.type === 'capture-request' || event.type === 'capture-request-cancelled') {
    // Capture requests are HUD-only; other roles see neither submission
    // nor cancellation (cancellation is a HUD coordination signal).
    return role === 'hud'
  }
  return true
}

export function createEventBus(): EventBus {
  const entries = new Set<Entry>()

  return {
    subscribe(role, listener) {
      const entry: Entry = { role, listener }
      entries.add(entry)
      return () => {
        entries.delete(entry)
      }
    },

    broadcast(event) {
      for (const entry of entries) {
        if (!shouldDeliver(event, entry.role)) continue
        try {
          entry.listener(event)
        } catch (err) {
          // One bad subscriber must not block delivery to the rest. We
          // log to stderr so the dev sees something; the SSE layer can
          // also detect the broken response and unsubscribe.
          console.error('[llui:notes] subscriber listener threw:', err)
        }
      }
    },

    countByRole(role) {
      let n = 0
      for (const entry of entries) if (entry.role === role) n++
      return n
    },
  }
}
