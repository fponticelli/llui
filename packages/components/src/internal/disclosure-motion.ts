/**
 * A disclosure exit can be driven by a CSS `@keyframes` animation OR a plain
 * CSS transition — a skin author reasonably reaches for either, and nothing
 * here should care which. `AnimationEvent` and `TransitionEvent` carry the
 * motion's name under different fields (`animationName` vs `propertyName`),
 * and the running effect objects `Element.getAnimations()` returns are
 * `CSSAnimation`/`CSSTransition` respectively, which likewise expose the name
 * under different properties. Every function below is written once against
 * this shared vocabulary instead of twice against each concrete type — a
 * transition-only skin used to leave the exit tracker permanently stuck
 * `closing` + `inert` because only `onAnimationStart`/`onAnimationEnd`/
 * `onAnimationCancel` were ever wired, so `getAnimations()` saw the running
 * CSSTransition (declining the "nothing is running" safety net, correctly)
 * while no event the component listened for ever told it the transition had
 * ENDED (#264 review item 4a).
 */
export type MotionEvent = AnimationEvent | TransitionEvent

function isAnimationEvent(event: MotionEvent): event is AnimationEvent {
  return 'animationName' in event
}

/** The motion's name, whichever concrete event kind fired. */
function motionName(event: MotionEvent): string {
  return isAnimationEvent(event) ? event.animationName : event.propertyName
}

interface NamedEffect extends Animation {
  readonly animationName?: string
  readonly transitionProperty?: string
}

/** The name a running effect object (`CSSAnimation`/`CSSTransition`) carries,
 * matching whichever field `motionName` would read off the corresponding
 * event. A plain Web Animations `Animation` (neither) has no name and never
 * matches. */
function effectName(effect: NamedEffect): string | undefined {
  return effect.animationName ?? effect.transitionProperty
}

/**
 * Measure the content's natural logical block size at the animation boundary.
 *
 * CSS cannot interpolate from `0` to `auto`. Both supported skins instead
 * animate to this pixel custom property, which is refreshed for every enter
 * and exit so dynamic content never reuses a stale endpoint.
 */
export function measureDisclosureBlockSize(event: MotionEvent): void {
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

export interface ArmedDisclosureExit {
  readonly name: string
  readonly generation: number
  readonly effect?: Animation
}

function liveEffects(element: HTMLElement): readonly NamedEffect[] {
  return typeof element.getAnimations === 'function'
    ? (element.getAnimations({ subtree: false }) as NamedEffect[])
    : []
}

/**
 * Arm the concrete CSS animation/transition that began for one exit
 * generation.
 *
 * A skin's `[data-state='closing']` rule publishing `--llui-disclosure-exit-
 * animation: <name>` disambiguates WHICH of possibly several simultaneous
 * effects on the element is the exit — required when the skin animates more
 * than one property with more than one keyframe/transition. When no name is
 * published, the browser's own name is trusted directly: this element is
 * only ever animated by disclosure motion, so any effect starting while the
 * item is `closing` IS the exit. Requiring the named variable unconditionally
 * used to mean a custom skin with a perfectly real exit animation — just
 * without that one custom property — never armed at all, leaving the item
 * `closing` + `inert` forever once its animation ended (the end event had
 * nothing armed to complete).
 *
 * `enterEffect` is the concrete effect object captured for this element's
 * most recent ENTER (tracked by the caller), excluded from the candidate
 * search so a same-named, still-lingering enter effect can never be mistaken
 * for the exit that just started.
 */
export function armDisclosureExit(
  event: MotionEvent,
  generation: number,
  enterEffect?: Animation,
): ArmedDisclosureExit | undefined {
  measureDisclosureBlockSize(event)
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement))
    return undefined
  const element = event.currentTarget
  const expectedName = getComputedStyle(element)
    .getPropertyValue('--llui-disclosure-exit-animation')
    .trim()
  const name = motionName(event)
  if (expectedName !== '' && name !== expectedName) return undefined
  const effect = liveEffects(element).find(
    (candidate) =>
      effectName(candidate) === name &&
      candidate.playState !== 'finished' &&
      candidate.playState !== 'idle' &&
      candidate !== enterEffect,
  )
  return {
    name,
    generation,
    ...(effect === undefined ? {} : { effect }),
  }
}

/**
 * Match completion to the exact armed generation and, when Web Animations is
 * available, the concrete effect object. A stale same-name cancel sees the
 * newer effect still running and cannot consume it.
 */
export function matchesArmedDisclosureExit(
  event: MotionEvent,
  generation: number,
  armed: ArmedDisclosureExit | undefined,
): armed is ArmedDisclosureExit {
  if (
    event.currentTarget !== event.target ||
    armed === undefined ||
    armed.generation !== generation ||
    armed.name !== motionName(event)
  )
    return false
  return (
    armed.effect === undefined || !['running', 'paused', 'pending'].includes(armed.effect.playState)
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
  /** Wire to the content element's `onAnimationStart` AND `onTransitionStart`. */
  readonly armExit: (event: MotionEvent, current: DisclosureExitState) => void
  /** Wire to `onAnimationEnd`/`onAnimationCancel`/`onTransitionEnd`/
   * `onTransitionCancel`. Returns `true` when this event completes the
   * currently armed exit generation — the caller sends its own
   * `exitComplete` message (whose payload shape differs per component) only
   * then. */
  readonly completeExit: (event: MotionEvent, current: DisclosureExitState) => boolean
  /**
   * Call SYNCHRONOUSLY right after the `send()` that applies a closing
   * transition (e.g. from the trigger's `onClick`, before the event loop
   * turn ends). `Element.getAnimations()` forces a style flush per spec, so
   * it already reflects an animation/transition the attribute change just
   * triggered — even though the browser has not yet queued a start event for
   * it. If the skin runs NO real exit motion for `closing` (a dropped rule, a
   * media query that doesn't match, `animation: none`/`transition: none`), no
   * start/end event will EVER fire, and the item would stay `closing` +
   * `inert` forever; this checks for exactly that and completes immediately
   * instead. Returns `true` when it completed.
   *
   * Environments with no Web Animations support (`getAnimations` absent,
   * e.g. jsdom) cannot tell "no animation" from "unknown", so this is
   * correctly a no-op there rather than guessing — it always returns
   * `false`, leaving the existing event-driven path as the only completion
   * route, exactly as before this method existed.
   */
  readonly completeIfUnanimated: (element: Element | null, current: DisclosureExitState) => boolean
}

/** Standalone form of `DisclosureExitTracker.completeIfUnanimated`, usable
 * outside a live tracker instance — it consults only the element's current
 * running effects and the given state, no tracker-private bookkeeping. Used
 * by a `watchExitCompletion` observer to settle a value that entered
 * `closing` from a message the click/keydown handlers never saw (a
 * PROGRAMMATIC close/toggle/setValue sent directly by the host app, #264
 * review item 4b) — the in-handler safety net above only ever runs for a
 * user-initiated close. */
export function completeIfUnanimated(
  element: Element | null,
  current: DisclosureExitState,
): boolean {
  if (!current.closing || element === null || !(element instanceof HTMLElement)) return false
  if (typeof element.getAnimations !== 'function') return false
  const running = element
    .getAnimations({ subtree: false })
    .filter((candidate) => ['running', 'paused', 'pending'].includes(candidate.playState))
  return running.length === 0
}

/**
 * ONE shared arm/match state machine for every disclosure component that
 * retains `closing` content until its own exit animation/transition ends.
 * Construct one per `connect()` call — its WeakMaps are keyed by the live DOM
 * node, so a single instance safely tracks every item's own content element
 * (accordion has one instance for the whole `connect()`, addressing N items;
 * collapsible has exactly one content element).
 */
export function createDisclosureExitTracker(): DisclosureExitTracker {
  const armedExits = new WeakMap<EventTarget, ArmedDisclosureExit>()
  const enterEffects = new WeakMap<EventTarget, Animation>()

  return {
    armExit(event, current) {
      const target = event.currentTarget
      if (target === null || target !== event.target || !(target instanceof HTMLElement)) return
      if (current.closing) {
        const armed = armDisclosureExit(event, current.generation, enterEffects.get(target))
        if (armed !== undefined) armedExits.set(target, armed)
      } else {
        measureDisclosureBlockSize(event)
        armedExits.delete(target)
        const name = motionName(event)
        const enter = liveEffects(target).find(
          (candidate) =>
            effectName(candidate) === name &&
            candidate.playState !== 'finished' &&
            candidate.playState !== 'idle',
        )
        if (enter === undefined) enterEffects.delete(target)
        else enterEffects.set(target, enter)
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
    completeIfUnanimated,
  }
}
