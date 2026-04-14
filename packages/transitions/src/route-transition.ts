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
 * spreading into a `branch()` call to animate page transitions.
 *
 * Can be called two ways:
 *
 * 1. With route-specific options (produces a fade + optional slide):
 *    ```ts
 *    branch({ on, cases, ...routeTransition({ duration: 200 }) })
 *    ```
 *
 * 2. With a pre-built `TransitionOptions` (e.g. from any preset):
 *    ```ts
 *    branch({ on, cases, ...routeTransition(fade({ duration: 200 })) })
 *    ```
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
