import type { TransitionOptions } from '@llui/dom'
import { asElements } from './style-utils.js'
import { prefersReducedMotion } from './anim.js'

export interface SpringOptions {
  /** Spring stiffness (default: 170). */
  stiffness?: number
  /** Damping coefficient (default: 26). */
  damping?: number
  /** Mass (default: 1). */
  mass?: number
  /** Stop threshold for velocity and position (default: 0.01). */
  precision?: number
  /** CSS property to animate (default: 'opacity'). */
  property?: string
  /** Start value (default: 0). */
  from?: number
  /** End value (default: 1). */
  to?: number
  /** Honor `prefers-reduced-motion` (default: true) — jump to the target instantly when reduced motion is requested. */
  respectReducedMotion?: boolean
}

interface SpringState {
  position: number
  velocity: number
}

function simulateSpring(
  state: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  mass: number,
  dt: number,
): void {
  const acceleration = (-stiffness * (state.position - target) - damping * state.velocity) / mass
  state.velocity += acceleration * dt
  state.position += state.velocity * dt
}

function isSettled(state: SpringState, target: number, precision: number): boolean {
  return Math.abs(state.velocity) < precision && Math.abs(state.position - target) < precision
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * Spring-physics transition. Returns `{ enter, leave }` that animate a CSS
 * property using a damped spring simulation driven by `requestAnimationFrame`.
 *
 * When `requestAnimationFrame` can't drive the loop — server render, or a
 * hidden/background tab where rAF is paused — the animation settles instantly
 * to its target and the returned Promise still resolves. This matters for the
 * `leave` Promise: it gates DOM removal, so a spring leave in a hidden tab must
 * not hang (e.g. `fromTransition(spring())` route navigation). Honoring
 * `prefers-reduced-motion` takes the same instant-settle path.
 *
 * Interruption: enter and leave on the SAME element supersede each other. A new
 * phase cancels the previous element's loop WITHOUT letting it snap to its own
 * (now-stale) target, so an enter interrupted by a leave rests at the leave
 * target rather than being clobbered back to the enter target by the dying loop.
 *
 * Passed as the trailing transition argument to the signal `show`/`branch`/`each`
 * primitives to spring an arm/row in and defer its leave, e.g.
 * `show(state.at('open'), () => [panel()], undefined, spring())`; also consumed
 * at the route/container seam via `fromTransition` in `@llui/vike/client`.
 */
export function spring(opts: SpringOptions = {}): TransitionOptions {
  const stiffness = opts.stiffness ?? 170
  const damping = opts.damping ?? 26
  const mass = opts.mass ?? 1
  const precision = opts.precision ?? 0.01
  const property = opts.property ?? 'opacity'
  const from = opts.from ?? 0
  const to = opts.to ?? 1
  const respectReduced = opts.respectReducedMotion !== false

  // Per-element cancellation. A new phase (enter↔leave) on an element marks the
  // previous loop cancelled; that loop then stops without writing, so two loops
  // never fight over the same style and no stale loop snaps back to its target.
  const runs = new WeakMap<HTMLElement, { cancelled: boolean }>()

  const animateOne = (el: HTMLElement, start: number, target: number): Promise<void> => {
    // Supersede any in-flight loop on this element (no snap — we own it now).
    const prev = runs.get(el)
    if (prev) prev.cancelled = true
    const run = { cancelled: false }
    runs.set(el, run)

    return new Promise<void>((resolve) => {
      let settled = false

      const cleanup = (): void => {
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }

      // Finish the loop. `write` controls whether the final value is committed —
      // a natural settle / hidden-tab snap writes the target; a supersede does
      // NOT (the newer loop owns the element's value).
      const done = (write: boolean, value: number): void => {
        if (settled) return
        settled = true
        if (write) el.style.setProperty(property, String(value))
        cleanup()
        if (runs.get(el) === run) runs.delete(el)
        resolve()
      }
      const snap = (): void => done(true, target)
      const onVisibility = (): void => {
        if (isDocumentHidden()) snap()
      }

      // Apply the initial value.
      el.style.setProperty(property, String(start))

      const rafAvailable = typeof requestAnimationFrame === 'function'

      // Reduced motion, no animation loop (SSR / minimal jsdom), or an already
      // hidden tab: settle straight to the target so the Promise always resolves.
      if ((respectReduced && prefersReducedMotion()) || !rafAvailable || isDocumentHidden()) {
        snap()
        return
      }

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility)
      }

      const state: SpringState = { position: start, velocity: 0 }
      let lastTime: number | null = null

      function step(time: number): void {
        if (settled) return
        // Superseded by a newer phase — stop WITHOUT snapping.
        if (run.cancelled) {
          done(false, target)
          return
        }
        // If the tab was hidden mid-flight, rAF stalls — settle so we don't hang.
        if (isDocumentHidden()) {
          snap()
          return
        }
        if (lastTime === null) {
          lastTime = time
        }

        // dt in seconds, clamped to avoid spiral on tab-switch
        const dt = Math.min((time - lastTime) / 1000, 0.064)
        lastTime = time

        simulateSpring(state, target, stiffness, damping, mass, dt)
        el.style.setProperty(property, String(state.position))

        if (isSettled(state, target, precision)) {
          snap()
          return
        }

        requestAnimationFrame(step)
      }

      requestAnimationFrame(step)
    })
  }

  const animateAll = (els: HTMLElement[], start: number, target: number): Promise<void> => {
    if (els.length === 0) return Promise.resolve()
    return Promise.all(els.map((el) => animateOne(el, start, target))).then(() => undefined)
  }

  const enter = (nodes: Node[]): void => {
    void animateAll(asElements(nodes), from, to)
  }

  // The element's live value for `property`, used as the leave start so an
  // interrupted enter leaves from wherever it currently sits rather than
  // snapping to the fully-shown `to`. Prefers computed, then inline, then `to`.
  const currentValue = (el: HTMLElement): number => {
    if (typeof getComputedStyle === 'function') {
      const computed = parseFloat(getComputedStyle(el).getPropertyValue(property))
      if (!Number.isNaN(computed)) return computed
    }
    const inline = parseFloat(el.style.getPropertyValue(property))
    return Number.isNaN(inline) ? to : inline
  }

  const leave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()
    // Per-element start: each leaving element reads its OWN current value, so a
    // mid-flight enter continues out from where it is instead of jumping to `to`.
    return Promise.all(els.map((el) => animateOne(el, currentValue(el), from))).then(
      () => undefined,
    )
  }

  return { enter, leave }
}
