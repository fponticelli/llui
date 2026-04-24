import type { PairingRegistry } from './pairing-registry.js'
import type { ServerFrame } from '../../protocol.js'

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

/**
 * Await a `confirm-resolved` frame for the given `confirmId`.
 * Resolves with `{outcome: 'user-cancelled'}` on timeout or pairing
 * drop (approvals lapse when the user isn't present to act on them).
 */
export async function waitForConfirm(
  registry: PairingRegistry,
  tid: string,
  confirmId: string,
  timeoutMs: number,
): Promise<{ outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }> {
  if (!registry.isPaired(tid)) return { outcome: 'user-cancelled' }

  return new Promise((resolve) => {
    let settled = false
    const done = (result: { outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubFrame()
      unsubClose()
      resolve(result)
    }

    const unsubFrame = registry.subscribe(tid, (frame) => {
      if (frame.t === 'confirm-resolved' && frame.confirmId === confirmId) {
        done({ outcome: frame.outcome, stateAfter: frame.stateAfter })
        return true
      }
      return false
    })

    const unsubClose = registry.onClose(tid, () => {
      done({ outcome: 'user-cancelled' })
    })

    const timer = setTimeout(() => {
      done({ outcome: 'user-cancelled' })
    }, timeoutMs)
  })
}

/**
 * Await a `state-update` frame whose path matches (exact or prefix).
 * Used by the long-poll `/lap/v1/wait` endpoint for external state
 * pushes (WebSocket messages, timers) arriving while the LLM is idle.
 */
export async function waitForChange(
  registry: PairingRegistry,
  tid: string,
  path: string | undefined,
  timeoutMs: number,
): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }> {
  if (!registry.isPaired(tid)) return { status: 'timeout', stateAfter: null }

  return new Promise((resolve) => {
    let settled = false
    const done = (result: { status: 'changed' | 'timeout'; stateAfter: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubFrame()
      unsubClose()
      resolve(result)
    }

    const unsubFrame = registry.subscribe(tid, (frame) => {
      if (frame.t !== 'state-update') return false
      if (path === undefined || frame.path === path || frame.path.startsWith(path)) {
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
  })
}
