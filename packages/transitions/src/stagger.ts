import type { TransitionOptions } from '@llui/dom'
import { prefersReducedMotion } from './anim.js'

export interface StaggerOptions {
  /** Delay between each item in milliseconds (default: 30). */
  delayPerItem?: number
  /** How to stagger leave animations: 'sequential' (same order as enter),
   *  'reverse', or 'simultaneous' (no stagger). Default: 'simultaneous'. */
  leaveOrder?: 'sequential' | 'reverse' | 'simultaneous'
  /** Honor `prefers-reduced-motion` (default: true) — drop the per-item stagger delays when reduced motion is requested. */
  respectReducedMotion?: boolean
}

/**
 * A wrapped phase whose base hook is waiting out its stagger delay. Tracked per
 * NODE so the OPPOSITE phase can cancel it before it fires — the runtime can
 * reverse a phase mid-delay (`each` resurrects a row that is animating out and
 * re-invokes `enter` on the same nodes). A leave that fired afterwards would
 * park a row that is staying at the leave resting values, with nothing left to
 * undo them: mounted, laid out, permanently invisible.
 */
interface ScheduledPhase {
  /** Nodes still due to run. Cancelled nodes are removed; empty ⇒ nothing to do. */
  nodes: Set<Node>
  /** Set once `arm` schedules the timer; absent while still reserved. */
  timer?: ReturnType<typeof setTimeout>
  /** True once every node was cancelled, so a pending `arm` becomes a no-op. */
  cancelled: boolean
  /** Settles the promise handed back to the runtime (it gates DOM removal). */
  resolve: () => void
}

export function stagger(spec: TransitionOptions, opts?: StaggerOptions): TransitionOptions {
  const delayPerItem = opts?.delayPerItem ?? 30
  const leaveOrder = opts?.leaveOrder ?? 'simultaneous'
  const respectReduced = opts?.respectReducedMotion !== false
  // Reduced motion: drop the per-item delays entirely — the wrapped preset runs
  // immediately per item (and itself resolves instantly if it honors the setting).
  const reducedMotion = (): boolean => respectReduced && prefersReducedMotion()

  // Deferred phases, keyed by node so each phase can cancel the other's.
  const scheduledEnter = new WeakMap<Node, ScheduledPhase>()
  const scheduledLeave = new WeakMap<Node, ScheduledPhase>()

  /** Settle `result` (promise or not) into `resolve`. */
  function settle(result: void | Promise<void>, resolve: () => void): void {
    if (result && typeof (result as Promise<void>).then === 'function') {
      ;(result as Promise<void>).then(resolve, resolve)
    } else {
      resolve()
    }
  }

  /**
   * Reserve `nodes` in `map` immediately, BEFORE any delay is known. The reverse
   * order can only compute its delay on a microtask, and a cancellation arriving
   * in that window must still land — so registration happens up front and `arm`
   * checks the reservation is still live.
   */
  function reserve(map: WeakMap<Node, ScheduledPhase>, nodes: Node[], resolve: () => void) {
    const entry: ScheduledPhase = { nodes: new Set(nodes), cancelled: false, resolve }
    for (const node of nodes) map.set(node, entry)
    return entry
  }

  /** Run `base` on the reservation's surviving nodes, now or after `delay`. */
  function arm(
    map: WeakMap<Node, ScheduledPhase>,
    entry: ScheduledPhase,
    base: (nodes: Node[]) => void | Promise<void>,
    delay: number,
  ): void {
    const fire = (): void => {
      if (entry.cancelled) return // resolved by the cancellation
      const remaining = Array.from(entry.nodes)
      for (const node of remaining) map.delete(node)
      entry.nodes.clear()
      settle(base(remaining), entry.resolve)
    }
    if (entry.cancelled) return
    if (delay <= 0) {
      fire()
      return
    }
    entry.timer = setTimeout(fire, delay)
  }

  /**
   * Drop `nodes` from any phase deferred in `map`. A reservation left with no
   * nodes is cancelled outright and RESOLVED — the runtime gates DOM removal on
   * that promise, so one that never settled would strand the row's teardown.
   */
  function cancelScheduled(map: WeakMap<Node, ScheduledPhase>, nodes: Node[]): void {
    for (const node of nodes) {
      const entry = map.get(node)
      if (!entry) continue
      map.delete(node)
      entry.nodes.delete(node)
      if (entry.nodes.size > 0 || entry.cancelled) continue
      entry.cancelled = true
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.resolve()
    }
  }

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
      // These nodes are staying — drop any leave still waiting out its delay.
      cancelScheduled(scheduledLeave, nodes)
      if (reducedMotion()) return baseEnter(nodes)
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
        arm(scheduledEnter, reserve(scheduledEnter, nodes, resolve), baseEnter, delay)
      })
    }
  }

  if (spec.leave) {
    const baseLeave = spec.leave
    out.leave = (nodes: Node[]) => {
      // These nodes are going — drop any enter still waiting out its delay, or it
      // would animate them back in after the leave has finished.
      cancelScheduled(scheduledEnter, nodes)
      if (leaveOrder === 'simultaneous' || reducedMotion()) {
        return baseLeave(nodes)
      }

      const idx = leaveIndex++
      leaveBatchSize = leaveIndex
      if (!leaveResetScheduled) {
        leaveResetScheduled = true
        queueMicrotask(resetLeaveIndex)
      }

      // For reverse order, the delay depends on the batch size, which is only
      // known once the whole batch has been queued — so it is computed on a
      // microtask. The reservation is taken NOW so a cancellation arriving in
      // that window still lands.
      if (leaveOrder === 'reverse') {
        const capturedIdx = idx
        return new Promise<void>((resolve) => {
          const entry = reserve(scheduledLeave, nodes, resolve)
          queueMicrotask(() => {
            const reverseIdx = leaveBatchSize - 1 - capturedIdx
            arm(scheduledLeave, entry, baseLeave, reverseIdx * delayPerItem)
          })
        })
      }

      // sequential
      const delay = idx * delayPerItem
      if (delay === 0) {
        return baseLeave(nodes)
      }
      return new Promise<void>((resolve) => {
        arm(scheduledLeave, reserve(scheduledLeave, nodes, resolve), baseLeave, delay)
      })
    }
  }

  if (spec.onTransition) {
    out.onTransition = spec.onTransition
  }

  return out
}
