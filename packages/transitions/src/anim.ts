// Shared timing + interruption primitives for the transition helpers.
//
// Two concerns live here:
//   1. Completion timing — resolve a phase when the browser fires
//      `transitionend`/`animationend`, falling back to a timer so a throttled
//      or hidden tab (where those events never fire) still resolves.
//   2. Interruption — a per-element "run token" so that overlapping
//      enter/leave phases on a REUSED element don't interleave: a new run
//      first rolls back the previous run's transient mutations, and every
//      delayed cleanup checks that its token is still the current one before
//      touching the element.

import { camelToKebab } from './style-utils.js'

/** Buffer added to the fallback timer so styles settle before resolution. */
export const TIMING_BUFFER_MS = 16

/**
 * True when the user has requested reduced motion via the OS/browser setting
 * (`prefers-reduced-motion: reduce`). Every transition helper consults this and,
 * unless opted out (`respectReducedMotion: false`), resolves enter/leave to an
 * instant completion — the final visual state with no animation. Safe off-browser
 * or where `matchMedia` is unavailable (returns false).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Resolve after `ms` (+ buffer). Used where no element/event is available
 * (pure delay). Resolves synchronously for non-positive durations.
 */
export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms + TIMING_BUFFER_MS))
}

/** The `propertyName` a `transitionend` carries, when it carries one at all. */
function endedProperty(e: Event): string | undefined {
  const name = (e as TransitionEvent).propertyName
  return typeof name === 'string' ? name : undefined
}

/**
 * Resolve when the element's CSS transition/animation ends, or after
 * `durationMs` (+ buffer) as a fallback — whichever comes first. The fallback
 * is essential: in a background/throttled tab `transitionend` never fires, so
 * without it a Promise-gated leave would deadlock (e.g. route navigation).
 *
 * `properties` names the CSS properties this phase actually animates (see
 * `animatedProperties`); camelCase DOM keys are accepted and normalized. It is
 * load-bearing, not an optimization: the
 * runtime DETACHES a leaving node on this promise (`arm-controller.ts`), so
 * resolving on some unrelated `transitionend` — a hover `background-color` on
 * the same element, or the fast half of a `transition: opacity 100ms, transform
 * 500ms` pair — removes the node mid-animation (issue #105). Every listed
 * property must end before the wait resolves; a property that never fires falls
 * through to the timer, so being over-inclusive can only cost the early resolve,
 * never a hang.
 *
 * Two deliberate escape hatches:
 *  - An EMPTY `properties` means "nothing to discriminate on" — a class-driven
 *    spec contributes no style keys — so any end on the target resolves.
 *  - A `transitionend` with no `propertyName` (a synthetic `new Event(...)`)
 *    resolves too, for the same reason: there is no property to match, and
 *    ignoring what may be the genuine completion signal risks a stall. Every
 *    real browser populates the field, so this only affects synthetic events.
 *
 * `animationend` stays target-filtered only. It reports an `animationName` (a
 * `@keyframes` identifier), which carries no relation to a CSS property, so
 * there is nothing here to match it against.
 */
export function waitForEnd(
  el: Element,
  durationMs: number,
  properties?: readonly string[],
): Promise<void> {
  if (durationMs <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    // Consumed as each property's end arrives; empty ⇒ unfiltered. Normalized
    // here rather than trusted from the caller: a camelCase name would match no
    // event and silently downgrade every wait to its fallback timer.
    const pending = new Set((properties ?? []).map(camelToKebab))
    const finish = (): void => {
      if (done) return
      done = true
      el.removeEventListener('transitionend', onTransitionEnd)
      el.removeEventListener('animationend', onAnimationEnd)
      clearTimeout(timer)
      resolve()
    }
    const onTransitionEnd = (e: Event): void => {
      // Ignore bubbled events from descendants.
      if (e.target !== el) return
      const property = endedProperty(e)
      if (pending.size === 0 || property === undefined || property === '') {
        finish()
        return
      }
      // An unrelated property finishing says nothing about this phase.
      if (!pending.delete(property)) return
      if (pending.size === 0) finish()
    }
    const onAnimationEnd = (e: Event): void => {
      if (e.target === el) finish()
    }
    el.addEventListener('transitionend', onTransitionEnd)
    el.addEventListener('animationend', onAnimationEnd)
    const timer = setTimeout(finish, durationMs + TIMING_BUFFER_MS)
  })
}

// ── Per-element run registry (interruption handling) ────────────────

interface RunEntry {
  token: symbol
  /** Undo this run's transient mutations; invoked when a newer run supersedes it. */
  rollback: () => void
  /**
   * True once the phase finished animating but deliberately left its resting
   * values on the element (a completed `leave`). The entry STAYS registered so
   * a later phase on a REUSED element can still roll those values back, but it
   * no longer counts as in-flight for {@link RunScope.isActive}.
   */
  settled: boolean
}

/**
 * A run scope owns one `WeakMap<Element, run>`. Each `transition()` /
 * `collapse()` bundle creates ITS OWN scope, so a phase interrupts only the
 * previous phase of the SAME bundle (enter↔leave on a reused element), while
 * independent bundles composed onto the same element via `mergeTransitions`
 * (e.g. `fade()` opacity + `slide()` transform) coexist without clobbering
 * each other. The map is weak, so detached elements are never retained.
 */
export interface RunScope {
  /**
   * Roll back and clear any in-flight run on `el`. Call BEFORE snapshotting the
   * element's baseline styles for a new run, so the snapshot reflects the
   * restored (clean) state rather than a superseded run's transient values.
   */
  supersede(el: Element): void
  /**
   * Register a new run on `el`, returning its token. `rollback` undoes this
   * run's transient mutations and fires if a later run supersedes this one.
   */
  register(el: Element, rollback: () => void): symbol
  /** True while `token` is still the element's current run (not superseded). */
  isCurrent(el: Element, token: symbol): boolean
  /**
   * True when `el` has an IN-FLIGHT run — i.e. a phase is mid-animation and
   * about to be superseded. Lets a leave detect that it is interrupting an
   * enter. A {@link RunScope.settle}d run is registered but not in flight, so
   * it reads as false.
   */
  isActive(el: Element): boolean
  /**
   * Mark `token`'s run finished while KEEPING its rollback registered, for a
   * phase that intentionally leaves resting values on the element (a completed
   * `leave`, which stays hidden until the runtime detaches it). If the element
   * is instead REUSED — the `@llui/vike` route seam calls `enter` on the very
   * element it just left — the next phase's `supersede` restores the pre-leave
   * inline styles before it snapshots, so the residue is never mistaken for an
   * author-set value. When the element really is removed, the WeakMap entry is
   * collected with it and the rollback simply never runs. No-op if `token` has
   * already been superseded.
   */
  settle(el: Element, token: symbol): void
  /**
   * Clear the run entry outright if `token` is still current, WITHOUT firing its
   * rollback. For a phase that already restored the element itself (a completed
   * `enter`), so there is nothing left for a later phase to undo.
   */
  end(el: Element, token: symbol): void
}

export function createRunScope(): RunScope {
  const runs = new WeakMap<Element, RunEntry>()
  return {
    supersede(el) {
      const prev = runs.get(el)
      if (prev) {
        runs.delete(el)
        prev.rollback()
      }
    },
    register(el, rollback) {
      const token = Symbol('run')
      runs.set(el, { token, rollback, settled: false })
      return token
    },
    isCurrent(el, token) {
      return runs.get(el)?.token === token
    },
    isActive(el) {
      const entry = runs.get(el)
      return entry !== undefined && !entry.settled
    },
    settle(el, token) {
      const entry = runs.get(el)
      if (entry?.token === token) entry.settled = true
    },
    end(el, token) {
      if (runs.get(el)?.token === token) runs.delete(el)
    },
  }
}
