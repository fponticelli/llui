import type { TransitionOptions } from '@llui/dom'
import { asElements } from './style-utils.js'

export interface FlipOptions {
  duration?: number
  easing?: string
}

/**
 * FLIP (First-Last-Invert-Play) reorder animation for keyed lists.
 *
 * `onTransition` runs after a reconcile with `{ entering, leaving, parent }`.
 * It compares each surviving child's last-known position (kept in a
 * `WeakMap<Element, DOMRect>`) against its new one and, for any that moved,
 * plays an inverse-then-identity transform so the row appears to glide.
 *
 * Element retention is deliberately weak: the tracked positions live in a
 * `WeakMap` and the working set is derived from `parent`'s live children
 * (minus `leaving`) on each pass, so bulk-removed rows are never held and are
 * free to be garbage-collected. There is no independent strong Set.
 *
 * Combine with an item-level appear/disappear preset via `mergeTransitions`:
 *
 * ```ts
 * mergeTransitions(fade(), flip())
 * ```
 *
 * **Not yet wired:** the signal `each()` primitive does not currently invoke
 * `onTransition`, so spreading `flip()` onto an `each({...})` has no effect.
 * Wiring the structural reconcilers to call these hooks is a deferred
 * cross-package change; `flip()` and `mergeTransitions()` are the building
 * blocks that seam will consume.
 *
 * Requires WAAPI (`element.animate()`). In environments without it (old
 * browsers, minimal jsdom) positions are still tracked but no animation runs.
 */
export function flip(opts: FlipOptions = {}): TransitionOptions {
  const duration = opts.duration ?? 300
  const easing = opts.easing ?? 'ease-out'
  // Weak: entries vanish with their elements. No strong retention of rows.
  const positions = new WeakMap<Element, DOMRect>()

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
    // Seed a baseline position for freshly entering rows.
    enter: (nodes: Node[]) => {
      captureAfterFrame(asElements(nodes))
    },
    // No bookkeeping needed: leaving rows are excluded via `ctx.leaving`, and
    // the WeakMap drops them once detached.
    leave: () => {},
    onTransition: (ctx) => {
      const parent = ctx.parent as Element | null | undefined
      if (!parent) return
      const leaving = new Set<Element>(asElements(ctx.leaving))
      const entering = new Set<Element>(asElements(ctx.entering))

      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue
        if (leaving.has(child)) continue

        const prev = positions.get(child)
        const next = child.getBoundingClientRect()

        // Entering rows have no meaningful "First" yet — just record a baseline.
        if (prev && !entering.has(child) && (prev.left !== next.left || prev.top !== next.top)) {
          const dx = prev.left - next.left
          const dy = prev.top - next.top
          if (typeof child.animate === 'function') {
            child.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
              { duration, easing, fill: 'backwards' },
            )
          }
        }
        positions.set(child, next)
      }
    },
  }
}

/**
 * Merge multiple TransitionOptions into one, chaining their `enter`,
 * `leave`, and `onTransition` handlers in order. `leave` waits for every
 * part's returned Promise before resolving.
 *
 * Useful for combining an item-level animation (fade/slide/...) with flip():
 *
 * ```ts
 * mergeTransitions(fade(), flip())
 * ```
 *
 * (As with `flip()`, the `onTransition` half is only meaningful once the
 * structural reconcilers invoke it — not yet wired. See `flip()`.)
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
