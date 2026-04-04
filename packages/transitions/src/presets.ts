import type { TransitionOptions } from '@llui/dom'
import type { Styles } from './types'
import { transition } from './transition'
import { asElements, forceReflow } from './style-utils'

export interface FadeOptions {
  duration?: number
  easing?: string
  appear?: boolean
}

export function fade(opts: FadeOptions = {}): TransitionOptions {
  const duration = opts.duration ?? 200
  const easing = opts.easing ?? 'ease-out'
  const active: Styles = { transition: `opacity ${duration}ms ${easing}` }
  return transition({
    appear: opts.appear,
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
}

export function slide(opts: SlideOptions = {}): TransitionOptions {
  const direction = opts.direction ?? 'down'
  const distance = opts.distance ?? 20
  const duration = opts.duration ?? 250
  const easing = opts.easing ?? 'ease-out'
  const withFade = opts.fade !== false

  const offset = slideOffset(direction, distance)
  const props = withFade ? 'transform, opacity' : 'transform'
  const active: Styles = { transition: `${props} ${duration}ms ${easing}` }

  const hidden: Styles = { transform: offset }
  const visible: Styles = { transform: 'translate(0, 0)' }
  if (withFade) {
    hidden.opacity = 0
    visible.opacity = 1
  }

  return transition({
    appear: opts.appear,
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
}

export function scale(opts: ScaleOptions = {}): TransitionOptions {
  const from = opts.from ?? 0.95
  const duration = opts.duration ?? 200
  const easing = opts.easing ?? 'ease-out'
  const withFade = opts.fade !== false
  const origin = opts.origin ?? 'center'

  const props = withFade ? 'transform, opacity' : 'transform'
  const active: Styles = {
    transition: `${props} ${duration}ms ${easing}`,
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
}

/**
 * Animate an element open/closed along the y-axis (height) or x-axis (width).
 *
 * Unlike CSS-only presets, `collapse()` measures the element's natural size
 * at runtime — the animation works regardless of content size. Only the
 * first element in each `nodes` group is animated.
 */
export function collapse(opts: CollapseOptions = {}): TransitionOptions {
  const axis = opts.axis ?? 'y'
  const duration = opts.duration ?? 250
  const easing = opts.easing ?? 'ease-out'
  const appear = opts.appear !== false
  const sizeProp = axis === 'y' ? 'height' : 'width'

  const runEnter = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()
    const el = els[0]!

    // Measure natural size with content visible.
    const naturalSize = axis === 'y' ? el.scrollHeight : el.scrollWidth
    const style = el.style

    // Save values to restore.
    const prevOverflow = style.overflow
    const prevSize = style[sizeProp]
    const prevTransition = style.transition

    style.overflow = 'hidden'
    style[sizeProp] = '0px'
    style.transition = `${sizeProp} ${duration}ms ${easing}`
    forceReflow(el)
    style[sizeProp] = `${naturalSize}px`

    return wait(duration).then(() => {
      style.overflow = prevOverflow
      style[sizeProp] = prevSize
      style.transition = prevTransition
    })
  }

  const runLeave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()
    const el = els[0]!

    const naturalSize = axis === 'y' ? el.scrollHeight : el.scrollWidth
    const style = el.style
    style.overflow = 'hidden'
    style[sizeProp] = `${naturalSize}px`
    style.transition = `${sizeProp} ${duration}ms ${easing}`
    forceReflow(el)
    style[sizeProp] = '0px'

    return wait(duration)
  }

  const out: TransitionOptions = { leave: runLeave }
  if (appear) {
    out.enter = (nodes: Node[]) => {
      void runEnter(nodes)
    }
  }
  return out
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms + 16))
}
