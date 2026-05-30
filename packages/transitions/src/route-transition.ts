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
 * animating page-to-page transitions. Used in two ways:
 *
 * **Manual branch-based routing:** spread the result into a `branch()`
 * call that switches on the current route key. The runtime invokes
 * `enter` / `leave` as the branch swaps cases.
 *
 * ```ts
 * branch({
 *   on: (s) => s.route,
 *   cases: { '/': home, '/about': about },
 *   ...routeTransition({ duration: 200 }),
 * })
 * ```
 *
 * **Vike filesystem routing (`@llui/vike`):** Vike's `onRenderClient`
 * doesn't consume `{ enter, leave }` directly because each page is its
 * own component and the swap goes through dispose + clear + mount. Use
 * `fromTransition` from `@llui/vike/client` to adapt the transition to
 * the `onLeave` / `onEnter` hook shape:
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
 * The vike variant operates on the container element itself (the `#app`
 * div) — its opacity / transform fades out the whole page, then the new
 * page fades in when it mounts.
 *
 * Both call forms also accept a pre-built `TransitionOptions` from any
 * preset (`fade`, `slide`, `scale`, …) — `routeTransition` will pass it
 * through unchanged.
 */
export function routeTransition(
  opts?: RouteTransitionOptions | TransitionOptions,
): TransitionOptions {
  // If opts already has enter/leave, treat it as a pre-built TransitionOptions.
  if (opts && ('enter' in opts || 'leave' in opts)) {
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
