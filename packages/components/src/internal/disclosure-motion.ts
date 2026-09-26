/**
 * Measure the content's natural logical block size at the animation boundary.
 *
 * CSS cannot interpolate from `0` to `auto`. Both supported skins instead
 * animate to this pixel custom property, which is refreshed for every enter
 * and exit so dynamic content never reuses a stale endpoint.
 */
export function measureDisclosureBlockSize(event: AnimationEvent): void {
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement)) return
  const element = event.currentTarget
  const style = getComputedStyle(element)
  const writingMode = style.writingMode
  const vertical = writingMode.startsWith('vertical') || writingMode.startsWith('sideways')
  const scrollSize = vertical ? element.scrollWidth : element.scrollHeight
  const paddingStart = Number.parseFloat(style.paddingBlockStart) || 0
  const paddingEnd = Number.parseFloat(style.paddingBlockEnd) || 0
  const borderStart = Number.parseFloat(style.borderBlockStartWidth) || 0
  const borderEnd = Number.parseFloat(style.borderBlockEndWidth) || 0
  const blockSize =
    style.boxSizing === 'border-box'
      ? scrollSize + borderStart + borderEnd
      : scrollSize - paddingStart - paddingEnd
  if (!Number.isFinite(blockSize) || blockSize < 0) return
  element.style.setProperty('--llui-disclosure-block-size', `${blockSize}px`)
}

interface NamedAnimation extends Animation {
  readonly animationName?: string
}

export interface ArmedDisclosureExit {
  readonly animationName: string
  readonly generation: number
  readonly animation?: Animation
}

function liveAnimations(element: HTMLElement): readonly NamedAnimation[] {
  return typeof element.getAnimations === 'function'
    ? (element.getAnimations({ subtree: false }) as NamedAnimation[])
    : []
}

/**
 * Arm the concrete CSS animation that began for one exit generation.
 *
 * A skin's `[data-state='closing']` rule publishing `--llui-disclosure-exit-
 * animation: <name>` disambiguates WHICH of possibly several simultaneous
 * animations on the element is the exit — required when the skin animates
 * more than one property with more than one keyframe. When no name is
 * published, the browser's own `animationName` is trusted directly: this
 * element is only ever animated by disclosure motion, so any animation
 * starting while the item is `closing` IS the exit. Requiring the named
 * variable unconditionally used to mean a custom skin with a perfectly real
 * exit animation — just without that one custom property — never armed at
 * all, leaving the item `closing` + `inert` forever once its animation ended
 * (the `animationend` had nothing armed to complete).
 *
 * `enterAnimation` is the concrete `Animation` object captured for this
 * element's most recent ENTER (tracked by the caller), excluded from the
 * candidate search so a same-named, still-lingering enter animation can never
 * be mistaken for the exit that just started.
 */
export function armDisclosureExit(
  event: AnimationEvent,
  generation: number,
  enterAnimation?: Animation,
): ArmedDisclosureExit | undefined {
  measureDisclosureBlockSize(event)
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement))
    return undefined
  const element = event.currentTarget
  const expectedName = getComputedStyle(element)
    .getPropertyValue('--llui-disclosure-exit-animation')
    .trim()
  if (expectedName !== '' && event.animationName !== expectedName) return undefined
  const animation = liveAnimations(element).find(
    (candidate) =>
      candidate.animationName === event.animationName &&
      candidate.playState !== 'finished' &&
      candidate.playState !== 'idle' &&
      candidate !== enterAnimation,
  )
  return {
    animationName: event.animationName,
    generation,
    ...(animation === undefined ? {} : { animation }),
  }
}

/**
 * Match completion to the exact armed generation and, when Web Animations is
 * available, the concrete animation object. A stale same-name cancel sees the
 * newer animation still running and cannot consume it.
 */
export function matchesArmedDisclosureExit(
  event: AnimationEvent,
  generation: number,
  armed: ArmedDisclosureExit | undefined,
): armed is ArmedDisclosureExit {
  if (
    event.currentTarget !== event.target ||
    armed === undefined ||
    armed.generation !== generation ||
    armed.animationName !== event.animationName
  )
    return false
  return (
    armed.animation === undefined ||
    !['running', 'paused', 'pending'].includes(armed.animation.playState)
  )
}

/** The one fact a disclosure exit tracker needs about the current state,
 * named identically by every component that carries one (accordion is keyed
 * per item value; collapsible has exactly one). */
export interface DisclosureExitState {
  readonly closing: boolean
  readonly generation: number
}

export interface DisclosureExitTracker {
  /** Wire to the content element's `onAnimationStart`. */
  readonly armExit: (event: AnimationEvent, current: DisclosureExitState) => void
  /** Wire to `onAnimationEnd` AND `onAnimationCancel`. Returns `true` when
   * this event completes the currently armed exit generation — the caller
   * sends its own `exitComplete` message (whose payload shape differs per
   * component) only then. */
  readonly completeExit: (event: AnimationEvent, current: DisclosureExitState) => boolean
  /**
   * Call SYNCHRONOUSLY right after the `send()` that applies a closing
   * transition (e.g. from the trigger's `onClick`, before the event loop
   * turn ends). `Element.getAnimations()` forces a style flush per spec, so
   * it already reflects an animation the attribute change just triggered —
   * even though the browser has not yet queued `animationstart` for it. If
   * the skin runs NO real exit animation for `closing` (a dropped rule, a
   * media query that doesn't match, `animation: none`), no
   * animationstart/animationend event will EVER fire, and the item would
   * stay `closing` + `inert` forever; this checks for exactly that and
   * completes immediately instead. Returns `true` when it completed.
   *
   * Environments with no Web Animations support (`getAnimations` absent,
   * e.g. jsdom) cannot tell "no animation" from "unknown", so this is
   * correctly a no-op there rather than guessing — it always returns
   * `false`, leaving the existing event-driven path as the only completion
   * route, exactly as before this method existed.
   */
  readonly completeIfUnanimated: (element: Element | null, current: DisclosureExitState) => boolean
}

/**
 * ONE shared arm/match state machine for every disclosure component that
 * retains `closing` content until its own exit animation ends. Construct one
 * per `connect()` call — its WeakMaps are keyed by the live DOM node, so a
 * single instance safely tracks every item's own content element (accordion
 * has one instance for the whole `connect()`, addressing N items; collapsible
 * has exactly one content element).
 */
export function createDisclosureExitTracker(): DisclosureExitTracker {
  const armedExits = new WeakMap<EventTarget, ArmedDisclosureExit>()
  const enterAnimations = new WeakMap<EventTarget, Animation>()

  return {
    armExit(event, current) {
      const target = event.currentTarget
      if (target === null || target !== event.target || !(target instanceof HTMLElement)) return
      if (current.closing) {
        const armed = armDisclosureExit(event, current.generation, enterAnimations.get(target))
        if (armed !== undefined) armedExits.set(target, armed)
      } else {
        measureDisclosureBlockSize(event)
        armedExits.delete(target)
        const enter = liveAnimations(target).find(
          (candidate) =>
            candidate.animationName === event.animationName &&
            candidate.playState !== 'finished' &&
            candidate.playState !== 'idle',
        )
        if (enter === undefined) enterAnimations.delete(target)
        else enterAnimations.set(target, enter)
      }
    },
    completeExit(event, current) {
      const target = event.currentTarget
      if (target === null) return false
      if (
        !current.closing ||
        !matchesArmedDisclosureExit(event, current.generation, armedExits.get(target))
      )
        return false
      armedExits.delete(target)
      return true
    },
    completeIfUnanimated(element, current) {
      if (!current.closing || element === null || !(element instanceof HTMLElement)) return false
      if (typeof element.getAnimations !== 'function') return false
      const running = element
        .getAnimations({ subtree: false })
        .filter((candidate) => ['running', 'paused', 'pending'].includes(candidate.playState))
      return running.length === 0
    },
  }
}
