import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'

/**
 * Teardown primitives for a harness that owns an `http.Server`.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN `harness.ts` (#196). The harness
 * used to call `server.closeAllConnections()` under a comment claiming it
 * force-closed "agent WS connections". It cannot, and the belief is the exact
 * one #191 exists to kill. The corrected predicate, restated here because this
 * is where it has to be true:
 *
 *   An awaited `server.close()` withholds its callback until every connection is
 *   IDLE, so the wait is UNBOUNDED whenever one is not.
 *     - IDLE keep-alive .............. reaped on its own (0–1 ms). Nothing to do.
 *     - SSE / streaming / long-poll ... never idle, but STILL TRACKED, so
 *                                       `closeAllConnections()` does reach it.
 *                                       (`closeIdleConnections()` does not.)
 *     - UPGRADED socket .............. never idle AND no longer tracked: the
 *                                       server drops it from the list
 *                                       `closeAllConnections()` iterates at
 *                                       upgrade, while `net.Server._connections`
 *                                       still counts it. Neither call reaches it;
 *                                       the teardown must own the socket itself.
 *
 * So the guarantee is split in two and needs BOTH halves. `closeAllConnections()`
 * covers the plain-HTTP half; `trackUpgradedSockets` covers the upgraded half by
 * keeping every socket the server hands to an `upgrade` listener and destroying
 * it at teardown. With both, `closeServer` terminates regardless of what is open
 * and regardless of the ORDER the rest of the teardown ran in — which is the
 * real change, because the harness was previously safe only by the accident that
 * `browser.close()` happened to run first and the only WS lived in the browser.
 */
export interface UpgradeTracker {
  /** Destroy every socket still held, and forget them. */
  destroyAll(): void
  /** How many upgraded sockets are currently held. Test-visible on purpose. */
  readonly size: number
  /** Stop tracking (does not destroy). For a harness that outlives its server. */
  stop(): void
}

/**
 * Start tracking upgraded sockets on `server`.
 *
 * MUST be called BEFORE any other `upgrade` listener is attached. Listeners run
 * in registration order, and a handler that rejects a handshake destroys the
 * socket itself — registering first means teardown owns the socket for rejected
 * handshakes too, and destroying an already-destroyed socket is a no-op.
 */
export function trackUpgradedSockets(server: Server): UpgradeTracker {
  const sockets = new Set<Duplex>()

  const onUpgrade = (_req: unknown, socket: Duplex): void => {
    sockets.add(socket)
    // A socket that closes on its own must not be retained: a long-lived server
    // with churn would otherwise grow this set without bound.
    socket.once('close', () => sockets.delete(socket))
  }
  server.on('upgrade', onUpgrade)

  return {
    destroyAll(): void {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
    get size(): number {
      return sockets.size
    },
    stop(): void {
      server.off('upgrade', onUpgrade)
    },
  }
}

/**
 * Close an `http.Server` and wait for it, with both halves of the predicate
 * applied first so the wait is BOUNDED whatever is open.
 */
export async function closeServer(server: Server, tracker?: UpgradeTracker): Promise<void> {
  // Plain-HTTP half: keep-alive and any response still streaming.
  server.closeAllConnections?.()
  // Upgraded half: sockets the server no longer tracks but still counts.
  tracker?.destroyAll()
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Run teardown steps so that a throwing step cannot strand the ones after it.
 *
 * The harness's `close()` had no `try/finally`, so a `browser.close()` that
 * threw skipped `server.close()` entirely — and under CPU saturation
 * `browser.close()` burning playwright's non-configurable 30 s deadline is the
 * documented normal case (#180), i.e. the failure lands exactly when teardown is
 * most stressed. Every step runs; the first error is what surfaces, with the
 * rest attached, so a cascade does not hide its cause.
 */
export async function runTeardownSteps(
  steps: readonly (readonly [label: string, step: () => unknown | Promise<unknown>])[],
): Promise<void> {
  const failures: { label: string; error: unknown }[] = []
  for (const [label, step] of steps) {
    try {
      await step()
    } catch (error) {
      failures.push({ label, error })
    }
  }
  if (failures.length === 0) return
  const first = failures[0]!
  if (failures.length === 1) throw first.error
  throw new AggregateError(
    failures.map((f) => f.error),
    `teardown failed in ${failures.length} steps: ${failures.map((f) => f.label).join(', ')}`,
  )
}
