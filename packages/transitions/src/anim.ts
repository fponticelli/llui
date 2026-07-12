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

/** Buffer added to the fallback timer so styles settle before resolution. */
export const TIMING_BUFFER_MS = 16

/**
 * Resolve after `ms` (+ buffer). Used where no element/event is available
 * (pure delay). Resolves synchronously for non-positive durations.
 */
export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms + TIMING_BUFFER_MS))
}

/**
 * Resolve when the element's CSS transition/animation ends, or after
 * `durationMs` (+ buffer) as a fallback — whichever comes first. The fallback
 * is essential: in a background/throttled tab `transitionend` never fires, so
 * without it a Promise-gated leave would deadlock (e.g. route navigation).
 */
export function waitForEnd(el: Element, durationMs: number): Promise<void> {
  if (durationMs <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      el.removeEventListener('transitionend', onEnd)
      el.removeEventListener('animationend', onEnd)
      clearTimeout(timer)
      resolve()
    }
    const onEnd = (e: Event): void => {
      // Ignore bubbled events from descendants.
      if (e.target === el) finish()
    }
    el.addEventListener('transitionend', onEnd)
    el.addEventListener('animationend', onEnd)
    const timer = setTimeout(finish, durationMs + TIMING_BUFFER_MS)
  })
}

// ── Per-element run registry (interruption handling) ────────────────

interface RunEntry {
  token: symbol
  /** Undo this run's transient mutations; invoked when a newer run supersedes it. */
  rollback: () => void
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
  /** Clear the run entry if `token` is still current (natural completion). */
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
      runs.set(el, { token, rollback })
      return token
    },
    isCurrent(el, token) {
      return runs.get(el)?.token === token
    },
    end(el, token) {
      if (runs.get(el)?.token === token) runs.delete(el)
    },
  }
}
