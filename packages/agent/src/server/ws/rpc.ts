import type { PairingRegistry } from './pairing-registry.js'
import type { ServerFrame, ConfirmResolvedFrame } from '../../protocol.js'

export type RpcError = {
  code: 'paused' | 'invalid' | 'timeout' | 'schema-error' | 'internal' | string
  detail?: string
}

export type RpcOptions = { timeoutMs?: number }

/**
 * Send an `rpc` frame to the paired browser and await its
 * matching `rpc-reply` / `rpc-error`. Runs its own one-shot frame
 * subscription against the registry — no state stored on the
 * registry itself, which keeps the registry small enough to
 * implement in a Durable Object or other stateful primitive.
 *
 * Rejects with `{code: 'paused'}` when the pairing is absent,
 * `{code: 'timeout'}` when the browser doesn't reply in time,
 * or whatever the browser sent in its `rpc-error` frame otherwise.
 */
export async function rpc(
  registry: PairingRegistry,
  tid: string,
  tool: string,
  args: unknown,
  opts: RpcOptions = {},
): Promise<unknown> {
  if (!registry.isPaired(tid)) {
    const err: RpcError = { code: 'paused' }
    throw err
  }
  const id = crypto.randomUUID()
  const timeoutMs = opts.timeoutMs ?? 15_000

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubFrame()
      unsubClose()
      fn()
    }

    const unsubFrame = registry.subscribe(tid, (frame) => {
      if (frame.t === 'rpc-reply' && frame.id === id) {
        done(() => resolve(frame.result))
        return true
      }
      if (frame.t === 'rpc-error' && frame.id === id) {
        done(() => reject({ code: frame.code, detail: frame.detail } satisfies RpcError))
        return true
      }
      return false
    })

    const unsubClose = registry.onClose(tid, () => {
      done(() => reject({ code: 'paused' } satisfies RpcError))
    })

    const timer = setTimeout(() => {
      done(() => reject({ code: 'timeout' } satisfies RpcError))
    }, timeoutMs)

    try {
      const frame: ServerFrame = { t: 'rpc', id, tool, args }
      registry.send(tid, frame)
    } catch (e) {
      done(() => reject({ code: 'internal', detail: String(e) } satisfies RpcError))
    }
  })
}

/** Three-way result of awaiting a confirmation resolution. */
export type ConfirmWaitResult =
  | { outcome: 'confirmed'; stateAfter?: unknown }
  | { outcome: 'user-cancelled' }
  | { outcome: 'timeout' }

/** Map a browser `confirm-resolved` frame onto the three-way wait result. */
function mapConfirmFrame(frame: ConfirmResolvedFrame): ConfirmWaitResult {
  return frame.outcome === 'confirmed'
    ? { outcome: 'confirmed', stateAfter: frame.stateAfter }
    : { outcome: 'user-cancelled' }
}

/**
 * Await a `confirm-resolved` frame for the given `confirmId`. Three-way:
 *   - `confirmed`      — the user approved (carries `stateAfter`).
 *   - `user-cancelled` — the user explicitly rejected.
 *   - `timeout`        — no resolution arrived in `timeoutMs`, or the
 *     pairing dropped before one did.
 *
 * Timeout is reported HONESTLY as `timeout` (not as a fake
 * `user-cancelled`): the confirm is still live in the browser and a
 * later approval may still fire, so callers must surface
 * `pending-confirmation` / `still-pending` rather than lie about a
 * rejection. Pairing drop maps to `timeout` for the same reason — the
 * user wasn't present to cancel, they simply weren't reachable.
 *
 * LEVEL-TRIGGERED. The browser emits `confirm-resolved` exactly once.
 * `/message` and `/confirm-result` long-poll in series: each tears its
 * subscriber down on timeout, and the next re-arms a fresh one. If the
 * user approves in that inter-poll gap, an edge-triggered subscriber
 * would miss the frame forever (the action ran but the agent polls
 * `still-pending` indefinitely). To close that gap, the registry buffers
 * every `confirm-resolved` outcome keyed by `confirmId` with a TTL, and
 * this helper checks that buffer BEFORE subscribing — returning
 * immediately when the resolution already arrived.
 */
export async function waitForConfirm(
  registry: PairingRegistry,
  tid: string,
  confirmId: string,
  timeoutMs: number,
): Promise<ConfirmWaitResult> {
  if (!registry.isPaired(tid)) return { outcome: 'timeout' }

  // Level-triggered fast path: a resolution may have landed in the gap
  // between the previous poll's subscriber teardown and this one arming.
  const buffered = registry.getConfirmOutcome(tid, confirmId)
  if (buffered) return mapConfirmFrame(buffered)

  return new Promise((resolve) => {
    let settled = false
    const done = (result: ConfirmWaitResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubFrame()
      unsubClose()
      resolve(result)
    }

    const unsubFrame = registry.subscribe(tid, (frame) => {
      if (frame.t === 'confirm-resolved' && frame.confirmId === confirmId) {
        done(mapConfirmFrame(frame))
        return true
      }
      return false
    })

    const unsubClose = registry.onClose(tid, () => {
      done({ outcome: 'timeout' })
    })

    const timer = setTimeout(() => {
      done({ outcome: 'timeout' })
    }, timeoutMs)
  })
}

/**
 * Long-poll for a state change under `path` (a JSON pointer; `undefined`
 * watches the whole state). Used by `/lap/v1/wait` for external state
 * pushes (WebSocket messages, timers) arriving while the LLM is idle.
 *
 * Subscription-driven: the server ARMS a `watch { id, path }` on the
 * browser, which then emits a `state-update` carrying that `id` only
 * when the pointer's resolved value actually changes — so an idle
 * session ships nothing per commit, and a path-scoped wait matches the
 * right change (the old `/`-broadcast-plus-prefix scheme could never
 * match a specific path). We correlate strictly by `id`, disarm the
 * watch (`unwatch`) whichever way the poll settles, and return the full
 * `stateAfter` snapshot the browser sent.
 */
export async function waitForChange(
  registry: PairingRegistry,
  tid: string,
  path: string | undefined,
  timeoutMs: number,
): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }> {
  if (!registry.isPaired(tid)) return { status: 'timeout', stateAfter: null }

  const id = crypto.randomUUID()

  return new Promise((resolve) => {
    let settled = false
    const done = (result: { status: 'changed' | 'timeout'; stateAfter: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubFrame()
      unsubClose()
      // Disarm the browser-side watch so it stops evaluating on commit.
      registry.send(tid, { t: 'unwatch', id })
      resolve(result)
    }

    const unsubFrame = registry.subscribe(tid, (frame) => {
      if (frame.t === 'state-update' && frame.id === id) {
        done({ status: 'changed', stateAfter: frame.stateAfter })
        return true
      }
      return false
    })

    const unsubClose = registry.onClose(tid, () => {
      done({ status: 'timeout', stateAfter: null })
    })

    const timer = setTimeout(() => {
      done({ status: 'timeout', stateAfter: null })
    }, timeoutMs)

    // Arm the watch AFTER wiring the subscriber/close/timer so a very
    // fast browser reply can't race an unsubscribed listener.
    registry.send(tid, { t: 'watch', id, path })
  })
}
