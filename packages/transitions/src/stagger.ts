import type { TransitionOptions } from '@llui/dom'

export interface StaggerOptions {
  /** Delay between each item in milliseconds (default: 30). */
  delayPerItem?: number
  /** How to stagger leave animations: 'sequential' (same order as enter),
   *  'reverse', or 'simultaneous' (no stagger). Default: 'simultaneous'. */
  leaveOrder?: 'sequential' | 'reverse' | 'simultaneous'
}

/**
 * Wrap any transition preset so that batch-entered items get staggered delays.
 *
 * Items entering within the same microtask are considered a "batch" and get
 * sequential delays (`index * delayPerItem`). The counter resets after the
 * microtask, so the next batch starts from 0.
 *
 * ```ts
 * stagger(fade({ duration: 150 }), { delayPerItem: 30 })
 * ```
 *
 * **Not yet wired for lists:** staggering only produces visible per-item delays
 * once the structural `each()` primitive invokes the `enter`/`leave` hooks per
 * row, which it does not do today. Until that runtime seam lands, `stagger`
 * wraps a bundle but there is no `each()` call site feeding it batched rows.
 */
export function stagger(spec: TransitionOptions, opts?: StaggerOptions): TransitionOptions {
  const delayPerItem = opts?.delayPerItem ?? 30
  const leaveOrder = opts?.leaveOrder ?? 'simultaneous'

  // ── Enter stagger ──────────────────────────────────────────────
  let enterIndex = 0
  let enterResetScheduled = false

  function resetEnterIndex(): void {
    enterIndex = 0
    enterResetScheduled = false
  }

  // ── Leave stagger ─────────────────────────────────────────────
  let leaveIndex = 0
  let leaveResetScheduled = false
  let leaveBatchSize = 0

  function resetLeaveIndex(): void {
    leaveIndex = 0
    leaveBatchSize = 0
    leaveResetScheduled = false
  }

  const out: TransitionOptions = {}

  if (spec.enter) {
    const baseEnter = spec.enter
    out.enter = (nodes: Node[]) => {
      const idx = enterIndex++
      if (!enterResetScheduled) {
        enterResetScheduled = true
        queueMicrotask(resetEnterIndex)
      }
      const delay = idx * delayPerItem
      if (delay === 0) {
        return baseEnter(nodes)
      }
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = baseEnter(nodes)
          if (result && typeof (result as Promise<void>).then === 'function') {
            ;(result as Promise<void>).then(resolve, resolve)
          } else {
            resolve()
          }
        }, delay)
      })
    }
  }

  if (spec.leave) {
    const baseLeave = spec.leave
    out.leave = (nodes: Node[]) => {
      if (leaveOrder === 'simultaneous') {
        return baseLeave(nodes)
      }

      const idx = leaveIndex++
      leaveBatchSize = leaveIndex
      if (!leaveResetScheduled) {
        leaveResetScheduled = true
        queueMicrotask(resetLeaveIndex)
      }

      // For reverse order, compute delay after all items in the batch are known.
      // Since we can't know the batch size ahead of time, we use a microtask
      // to capture it, but the delay must be applied now. For reverse, we use
      // a deferred approach: schedule the animation after the microtask.
      if (leaveOrder === 'reverse') {
        const capturedIdx = idx
        return new Promise<void>((resolve) => {
          // Wait for microtask to know batch size, then schedule with reverse delay.
          queueMicrotask(() => {
            const reverseIdx = leaveBatchSize - 1 - capturedIdx
            const delay = reverseIdx * delayPerItem
            if (delay === 0) {
              const result = baseLeave(nodes)
              if (result && typeof (result as Promise<void>).then === 'function') {
                ;(result as Promise<void>).then(resolve, resolve)
              } else {
                resolve()
              }
            } else {
              setTimeout(() => {
                const result = baseLeave(nodes)
                if (result && typeof (result as Promise<void>).then === 'function') {
                  ;(result as Promise<void>).then(resolve, resolve)
                } else {
                  resolve()
                }
              }, delay)
            }
          })
        })
      }

      // sequential
      const delay = idx * delayPerItem
      if (delay === 0) {
        return baseLeave(nodes)
      }
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = baseLeave(nodes)
          if (result && typeof (result as Promise<void>).then === 'function') {
            ;(result as Promise<void>).then(resolve, resolve)
          } else {
            resolve()
          }
        }, delay)
      })
    }
  }

  if (spec.onTransition) {
    out.onTransition = spec.onTransition
  }

  return out
}
