import type { TransitionOptions } from '@llui/dom'
import { asElements } from './style-utils'

export interface FlipOptions {
  duration?: number
  easing?: string
}

/**
 * FLIP (First-Last-Invert-Play) reorder animation for `each()` lists.
 *
 * Attach to an `each()` alongside item enter/leave transitions. After each
 * reconcile, items whose positions changed animate smoothly from their
 * previous position to the new one.
 *
 * ```ts
 * each({
 *   items: s => s.items,
 *   key: i => i.id,
 *   render,
 *   ...fade(),         // animates appear/disappear
 *   ...flip(),         // animates reorders
 * })
 * ```
 *
 * Spreading two transition helpers merges their hooks: `fade()` provides
 * `enter`/`leave`, `flip()` provides `enter` (position capture) and
 * `onTransition` (apply inverse + play). The `enter` from `flip()` overrides
 * `fade()`'s only if spread after — put `flip()` last.
 *
 * Actually, to combine both, use `mergeTransitions(fade(), flip())` which
 * chains `enter` handlers.
 *
 * Requires WAAPI (`element.animate()`). In environments without it (old
 * browsers, minimal jsdom) the transforms are applied without animation.
 */
export function flip(opts: FlipOptions = {}): TransitionOptions {
  const duration = opts.duration ?? 300
  const easing = opts.easing ?? 'ease-out'
  const positions = new WeakMap<Element, DOMRect>()
  const tracked = new Set<Element>()

  const captureAfterFrame = (els: HTMLElement[]): void => {
    const run = (): void => {
      for (const el of els) {
        if (el.isConnected) positions.set(el, el.getBoundingClientRect())
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      run()
    }
  }

  return {
    enter: (nodes: Node[]) => {
      const els = asElements(nodes)
      for (const el of els) tracked.add(el)
      captureAfterFrame(els)
    },
    leave: (nodes: Node[]) => {
      for (const el of asElements(nodes)) tracked.delete(el)
    },
    onTransition: () => {
      // Snapshot current set (tracked may mutate during iteration).
      const current = Array.from(tracked)
      for (const el of current) {
        if (!el.isConnected) {
          tracked.delete(el)
          continue
        }
        const prev = positions.get(el)
        const next = el.getBoundingClientRect()
        if (prev && (prev.left !== next.left || prev.top !== next.top)) {
          const dx = prev.left - next.left
          const dy = prev.top - next.top
          if (typeof el.animate === 'function') {
            el.animate(
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                { transform: 'translate(0, 0)' },
              ],
              { duration, easing, fill: 'backwards' },
            )
          }
        }
        positions.set(el, next)
      }
    },
  }
}

/**
 * Merge multiple TransitionOptions into one, chaining their `enter`,
 * `leave`, and `onTransition` handlers in order.
 *
 * Useful for combining an item-level animation (fade/slide/...) with flip():
 *
 * ```ts
 * each({ items, key, render, ...mergeTransitions(fade(), flip()) })
 * ```
 */
export function mergeTransitions(...parts: TransitionOptions[]): TransitionOptions {
  const enters = parts.map((p) => p.enter).filter((f): f is NonNullable<typeof f> => !!f)
  const leaves = parts.map((p) => p.leave).filter((f): f is NonNullable<typeof f> => !!f)
  const onTs = parts.map((p) => p.onTransition).filter((f): f is NonNullable<typeof f> => !!f)

  const out: TransitionOptions = {}
  if (enters.length > 0) {
    out.enter = (nodes: Node[]) => {
      for (const fn of enters) void fn(nodes)
    }
  }
  if (leaves.length > 0) {
    out.leave = (nodes: Node[]) => {
      // Wait for all leaves to resolve.
      const results = leaves.map((fn) => fn(nodes))
      const promises = results.filter(
        (r): r is Promise<void> => !!r && typeof (r as Promise<void>).then === 'function',
      )
      if (promises.length === 0) return
      return Promise.all(promises).then(() => undefined)
    }
  }
  if (onTs.length > 0) {
    out.onTransition = (ctx) => {
      for (const fn of onTs) void fn(ctx)
    }
  }
  return out
}
