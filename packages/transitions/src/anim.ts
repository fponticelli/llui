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
 * never a hang. That is not hypothetical: `slide()` and `scale()` name
 * `transform` but give it a 0s duration in their `transition` shorthand (#142),
 * so both currently resolve on the timer every time.
 *
 * Two deliberate escape hatches:
 *  - An EMPTY `properties` means "nothing to discriminate on" — a class-driven
 *    spec contributes no style keys — so any end on the target resolves.
 *  - A `transitionend` with no `propertyName` (a synthetic `new Event(...)`)
 *    resolves too, for the same reason: there is no property to match, and
 *    ignoring what may be the genuine completion signal risks a stall. Every
 *    real browser populates the field, so this only affects synthetic events.
 *
 * A `transitioncancel` consumes its property exactly as an end does: the browser
 * giving up IS this phase finishing, and without it a cancelled leave holds the
 * node in the DOM for its whole declared duration instead of resolving when the
 * animation stopped. It counts only for a transition this wait saw START,
 * though — superseding a mid-flight phase cancels ITS transitions, and those
 * cancel events are dispatched to the listener the NEXT phase attaches
 * microseconds later, in the same task. Consuming one of those would resolve a
 * phase that has not run for a single frame, and the runtime detaches a leaving
 * node on exactly this promise. (A cancel carrying no `propertyName` cannot be
 * attributed either way and takes the property-less path above.)
 *
 * `animationend` stays target-filtered only. It reports an `animationName` (a
 * `@keyframes` identifier), which carries no relation to a CSS property, so
 * there is nothing here to match it against — and for the same reason there is
 * no safe `animationcancel` handling to mirror the transition side with.
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
    // The properties whose transition THIS wait saw start, so a `transitioncancel`
    // can be told from the cancel of the phase this one superseded.
    const started = new Set<string>()
    const finish = (): void => {
      if (done) return
      done = true
      el.removeEventListener('transitionstart', onTransitionStart)
      el.removeEventListener('transitionend', onTransitionEnd)
      el.removeEventListener('transitioncancel', onTransitionCancel)
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
    const onTransitionStart = (e: Event): void => {
      if (e.target !== el) return
      const property = endedProperty(e)
      if (property !== undefined && property !== '') started.add(property)
    }
    const onTransitionCancel = (e: Event): void => {
      if (e.target !== el) return
      const property = endedProperty(e)
      // Attributable to a transition that was already running when this wait
      // began — not ours to consume.
      if (property !== undefined && property !== '' && !started.has(property)) return
      onTransitionEnd(e)
    }
    const onAnimationEnd = (e: Event): void => {
      if (e.target === el) finish()
    }
    el.addEventListener('transitionstart', onTransitionStart)
    el.addEventListener('transitionend', onTransitionEnd)
    el.addEventListener('transitioncancel', onTransitionCancel)
    el.addEventListener('animationend', onAnimationEnd)
    const timer = setTimeout(finish, durationMs + TIMING_BUFFER_MS)
  })
}

// ── Per-node run registry (interruption handling) ──────────────────

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
 * A run scope owns one `WeakMap<Node, run>`. Each bundle creates ITS OWN scope,
 * so a phase interrupts only the previous phase of the SAME bundle (enter↔leave
 * on a reused element), while independent bundles composed onto the same element
 * via `mergeTransitions` (e.g. `fade()` opacity + `slide()` transform) coexist
 * without clobbering each other. The map is weak, so detached nodes are never
 * retained.
 *
 * This is the package's ONE cancellation mechanism. `transition()`, `collapse()`,
 * `spring()`, `stagger()` and `flip()` all route through it — cancellation used
 * to be written four times and shared twice, which is precisely why the #40
 * interrupt fix landed in half the helpers (#111). A new helper that needs
 * per-element phase state asks for a scope; it does not hand-roll a `WeakMap`
 * with a `cancelled` flag. `test/shared-cancellation.test.ts` fails the build if
 * one comes back.
 *
 * Keyed on `Node`, not `Element`: `stagger()` defers whole node lists, comment
 * anchors included, and losing a non-element node from the registry would leave
 * its pending phase uncancellable.
 */
export interface RunScope {
  /**
   * Roll back and clear any in-flight run on `el`. Call BEFORE snapshotting the
   * element's baseline styles for a new run, so the snapshot reflects the
   * restored (clean) state rather than a superseded run's transient values.
   */
  supersede(el: Node): void
  /**
   * Register a new run on `el`, returning its token. `rollback` undoes this
   * run's transient mutations and fires if a later run supersedes this one.
   */
  register(el: Node, rollback: () => void): symbol
  /** True while `token` is still the element's current run (not superseded). */
  isCurrent(el: Node, token: symbol): boolean
  /**
   * True when `el` has an IN-FLIGHT run — i.e. a phase is mid-animation and
   * about to be superseded. Lets a leave detect that it is interrupting an
   * enter. A {@link RunScope.settle}d run is registered but not in flight, so
   * it reads as false.
   */
  isActive(el: Node): boolean
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
  settle(el: Node, token: symbol): void
  /**
   * Clear the run entry outright if `token` is still current, WITHOUT firing its
   * rollback. For a phase that already restored the element itself (a completed
   * `enter`), so there is nothing left for a later phase to undo.
   */
  end(el: Node, token: symbol): void
}

export function createRunScope(): RunScope {
  const runs = new WeakMap<Node, RunEntry>()
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
