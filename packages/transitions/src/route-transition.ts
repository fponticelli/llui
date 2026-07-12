import type { TransitionOptions } from '@llui/dom'
import { fade } from './presets.js'
import { slide } from './presets.js'
import { mergeTransitions } from './flip.js'

export interface RouteTransitionOptions {
  /** Duration in milliseconds (default: 250). */
  duration?: number
  /** Easing function (default: 'ease-out'). */
  easing?: string
  /** Enable a slight vertical slide alongside the fade (default: true). */
  slide?: boolean
  /** Slide distance in pixels (default: 12). */
  slideDistance?: number
}

/**
 * Convenience wrapper that returns `{ enter, leave }` hooks suitable for
 * animating page-to-page transitions.
 *
 * **Vike filesystem routing (`@llui/vike`):** this is the wired consumer.
 * Vike's `onRenderClient` doesn't take `{ enter, leave }` directly — each page
 * is its own component and the swap goes through dispose + clear + mount — so
 * `fromTransition` from `@llui/vike/client` adapts the bundle to the
 * `onLeave` / `onEnter` hook shape:
 *
 * ```ts
 * // pages/+onRenderClient.ts
 * import { createOnRenderClient, fromTransition } from '@llui/vike/client'
 * import { routeTransition } from '@llui/transitions'
 *
 * export const onRenderClient = createOnRenderClient({
 *   ...fromTransition(routeTransition({ duration: 200 })),
 * })
 * ```
 *
 * The vike variant operates on the container / page-slot element itself — its
 * opacity / transform fades out the whole page, then the new page fades in when
 * it mounts.
 *
 * > Note: spreading the result directly into a `branch()`/`show()` call does
 * > **not** animate anything today — the signal structural primitives don't yet
 * > accept transition hooks. Route-level animation goes through
 * > `fromTransition`, not the structural primitives.
 *
 * The call form also accepts a pre-built `TransitionOptions` from any preset or
 * composition (`fade`, `slide`, `scale`, `flip`, `mergeTransitions`, …) —
 * detected by the presence of an `enter`, `leave`, or `onTransition` hook — and
 * passes it through unchanged.
 */
export function routeTransition(
  opts?: RouteTransitionOptions | TransitionOptions,
): TransitionOptions {
  // If opts already carries any transition hook, treat it as a pre-built
  // TransitionOptions and pass it through. `onTransition` must be included:
  // an onTransition-only bundle (e.g. a bare flip()/mergeTransitions result)
  // would otherwise be misread as a RouteTransitionOptions config and dropped.
  if (opts && ('enter' in opts || 'leave' in opts || 'onTransition' in opts)) {
    return opts as TransitionOptions
  }

  const config = (opts ?? {}) as RouteTransitionOptions
  const duration = config.duration ?? 250
  const easing = config.easing ?? 'ease-out'
  const withSlide = config.slide !== false
  const slideDistance = config.slideDistance ?? 12

  const fadeT = fade({ duration, easing })

  if (!withSlide) return fadeT

  const slideT = slide({
    direction: 'up',
    distance: slideDistance,
    duration,
    easing,
    fade: false,
  })

  return mergeTransitions(fadeT, slideT)
}
