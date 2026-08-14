import type { TransitionOptions } from '@llui/dom'
import type { Styles } from './types.js'
import { transition } from './transition.js'
import { asElements, forceReflow, transitionShorthand } from './style-utils.js'
import { waitForEnd, createRunScope, prefersReducedMotion } from './anim.js'

export interface FadeOptions {
  duration?: number
  easing?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}

export function fade(opts: FadeOptions = {}): TransitionOptions {
  const duration = opts.duration ?? 200
  const easing = opts.easing ?? 'ease-out'
  const active: Styles = { transition: transitionShorthand(['opacity'], duration, easing) }
  return transition({
    appear: opts.appear,
    respectReducedMotion: opts.respectReducedMotion,
    duration,
    enterActive: active,
    enterFrom: { opacity: 0 },
    enterTo: { opacity: 1 },
    leaveActive: active,
    leaveFrom: { opacity: 1 },
    leaveTo: { opacity: 0 },
  })
}

export type SlideDirection = 'up' | 'down' | 'left' | 'right'

export interface SlideOptions {
  /** The direction the element slides IN from (default: 'down' — enters from below). */
  direction?: SlideDirection
  /** Pixel distance to slide (default: 20). */
  distance?: number
  duration?: number
  easing?: string
  /** Also animate opacity (default: true). */
  fade?: boolean
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}

/**
 * Slide an element in/out along one axis, optionally fading with it.
 *
 * Both animated properties carry their own duration and easing in the emitted
 * shorthand — `transform 250ms ease-out, opacity 250ms ease-out`. Writing the
 * properties as one list with a single trailing timing (`transform, opacity
 * 250ms ease-out`) gives `transform` the initial duration of 0s, so it snaps
 * and reports no `transitionend`; that was #142, and it is invisible to jsdom.
 */
export function slide(opts: SlideOptions = {}): TransitionOptions {
  const direction = opts.direction ?? 'down'
  const distance = opts.distance ?? 20
  const duration = opts.duration ?? 250
  const easing = opts.easing ?? 'ease-out'
  const withFade = opts.fade !== false

  const offset = slideOffset(direction, distance)
  const properties = withFade ? ['transform', 'opacity'] : ['transform']
  const active: Styles = { transition: transitionShorthand(properties, duration, easing) }

  const hidden: Styles = { transform: offset }
  const visible: Styles = { transform: 'translate(0, 0)' }
  if (withFade) {
    hidden.opacity = 0
    visible.opacity = 1
  }

  return transition({
    appear: opts.appear,
    respectReducedMotion: opts.respectReducedMotion,
    duration,
    enterActive: active,
    enterFrom: hidden,
    enterTo: visible,
    leaveActive: active,
    leaveFrom: visible,
    leaveTo: hidden,
  })
}

function slideOffset(direction: SlideDirection, distance: number): string {
  switch (direction) {
    case 'down':
      return `translate(0, -${distance}px)`
    case 'up':
      return `translate(0, ${distance}px)`
    case 'right':
      return `translate(-${distance}px, 0)`
    case 'left':
      return `translate(${distance}px, 0)`
  }
}

export interface ScaleOptions {
  /** Starting scale factor (default: 0.95). */
  from?: number
  duration?: number
  easing?: string
  /** Also animate opacity (default: true). */
  fade?: boolean
  /** Transform origin (default: 'center'). */
  origin?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}

/**
 * Scale an element in/out from `from` to 1, optionally fading with it.
 *
 * Emits the same per-property shorthand as {@link slide} — `transform 200ms
 * ease-out, opacity 200ms ease-out` — for the reason spelled out there (#142).
 * `transform-origin` rides along in the active value but never transitions, so
 * it is not one of the properties the phase waits on.
 */
export function scale(opts: ScaleOptions = {}): TransitionOptions {
  const from = opts.from ?? 0.95
  const duration = opts.duration ?? 200
  const easing = opts.easing ?? 'ease-out'
  const withFade = opts.fade !== false
  const origin = opts.origin ?? 'center'

  const properties = withFade ? ['transform', 'opacity'] : ['transform']
  const active: Styles = {
    transition: transitionShorthand(properties, duration, easing),
    transformOrigin: origin,
  }

  const hidden: Styles = { transform: `scale(${from})` }
  const visible: Styles = { transform: 'scale(1)' }
  if (withFade) {
    hidden.opacity = 0
    visible.opacity = 1
  }

  return transition({
    appear: opts.appear,
    respectReducedMotion: opts.respectReducedMotion,
    duration,
    enterActive: active,
    enterFrom: hidden,
    enterTo: visible,
    leaveActive: active,
    leaveFrom: visible,
    leaveTo: hidden,
  })
}

export interface CollapseOptions {
  /** Axis to collapse: 'y' = height, 'x' = width (default: 'y'). */
  axis?: 'x' | 'y'
  duration?: number
  easing?: string
  appear?: boolean
  /** Honor `prefers-reduced-motion` (default: true) — resolve instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}

/**
 * Animate an element open/closed along the y-axis (height) or x-axis (width).
 *
 * Unlike CSS-only presets, `collapse()` measures the element's natural size
 * at runtime — the animation works regardless of content size. Only the
 * first element in each `nodes` group is animated.
 *
 * Because it mutates `overflow` / `height` / `transition` inline, collapse
 * registers a per-element restore that runs the moment a later phase supersedes
 * it — so an interrupted open/close never leaves stale inline styles behind.
 *
 * Like the other presets, this bundle is passed as the trailing transition
 * argument to the signal `show`/`branch`/`each` primitives (e.g.
 * `show(state.at('open'), () => [panel()], undefined, collapse())`) and is also
 * consumed at the route/container seam via `fromTransition`.
 */
export function collapse(opts: CollapseOptions = {}): TransitionOptions {
  const axis = opts.axis ?? 'y'
  const duration = opts.duration ?? 250
  const easing = opts.easing ?? 'ease-out'
  const appear = opts.appear !== false
  const sizeProp = axis === 'y' ? 'height' : 'width'
  // The one property collapse transitions — anything else ending on the element
  // (a hover `background-color`, a sibling fade) must not resolve the wait and
  // let the runtime detach the row mid-collapse (#105).
  const sizeProperties = [sizeProp]
  const runs = createRunScope()
  const reducedMotion = (): boolean => opts.respectReducedMotion !== false && prefersReducedMotion()

  // Snapshot the element's clean baseline (after rolling back any in-flight
  // run) and return a restore closure for it.
  const snapshotRestore = (el: HTMLElement): (() => void) => {
    runs.supersede(el)
    const style = el.style
    const prevOverflow = style.overflow
    const prevSize = style[sizeProp]
    const prevTransition = style.transition
    return () => {
      style.overflow = prevOverflow
      style[sizeProp] = prevSize
      style.transition = prevTransition
    }
  }

  const runEnter = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()
    const el = els[0]!

    // Reduced motion: leave the element at its natural size, no collapse.
    if (reducedMotion()) {
      runs.supersede(el)
      return Promise.resolve()
    }

    // A run already in flight means this enter is REVERSING a leave mid-collapse.
    // Measure the element's current rendered size before `snapshotRestore`
    // supersedes that run — its rollback restores the pre-leave (natural) size,
    // so reading afterwards would report the far end. A fresh enter opens from
    // 0px as before.
    const interrupting = runs.isActive(el)
    const rect = interrupting ? el.getBoundingClientRect() : undefined
    const startSize = rect ? (axis === 'y' ? rect.height : rect.width) : 0

    const restore = snapshotRestore(el)
    const token = runs.register(el, restore)

    // Measure natural size with content visible.
    const naturalSize = axis === 'y' ? el.scrollHeight : el.scrollWidth
    const style = el.style

    style.overflow = 'hidden'
    style[sizeProp] = `${startSize}px`
    style.transition = transitionShorthand([sizeProp], duration, easing)
    forceReflow(el)
    style[sizeProp] = `${naturalSize}px`

    return waitForEnd(el, duration, sizeProperties).then(() => {
      if (!runs.isCurrent(el, token)) return
      restore()
      runs.end(el, token)
    })
  }

  const runLeave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()
    const el = els[0]!

    // Reduced motion: resolve at once so the runtime removes the element now.
    if (reducedMotion()) {
      runs.supersede(el)
      return Promise.resolve()
    }

    const restore = snapshotRestore(el)
    const token = runs.register(el, restore)

    // Start from the element's CURRENT rendered size, not its natural size, so an
    // enter interrupted mid-collapse leaves from the partial size it reached
    // rather than snapping open to full height first.
    const rect = el.getBoundingClientRect()
    const currentSize = axis === 'y' ? rect.height : rect.width
    const naturalSize = currentSize || (axis === 'y' ? el.scrollHeight : el.scrollWidth)
    const style = el.style
    style.overflow = 'hidden'
    style[sizeProp] = `${naturalSize}px`
    style.transition = transitionShorthand([sizeProp], duration, easing)
    forceReflow(el)
    style[sizeProp] = '0px'

    return waitForEnd(el, duration, sizeProperties).then(() => {
      // Leave finished — under show/branch/each the runtime removes the element
      // next, so keep the collapsed state. SETTLE rather than `end` the run: on
      // a REUSED element (the `@llui/vike` route seam calls enter on the element
      // it just left) the retained restore is what lets the next phase undo this
      // collapsed `height`/`overflow` before it snapshots its own baseline.
      runs.settle(el, token)
    })
  }

  const out: TransitionOptions = { leave: runLeave }
  if (appear) {
    out.enter = (nodes: Node[]) => {
      void runEnter(nodes)
    }
  }
  return out
}
