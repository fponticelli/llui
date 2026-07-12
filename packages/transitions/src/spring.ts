import type { TransitionOptions } from '@llui/dom'
import { asElements } from './style-utils.js'

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

function animateSpring(
  els: HTMLElement[],
  from: number,
  to: number,
  property: string,
  stiffness: number,
  damping: number,
  mass: number,
  precision: number,
): Promise<void> {
  if (els.length === 0) return Promise.resolve()

  const rafAvailable = typeof requestAnimationFrame === 'function'

  return new Promise<void>((resolve) => {
    let settled = false

    const cleanup = (): void => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    // Snap to the exact target and resolve. Used both on natural settle and as
    // the escape hatch when no rAF loop can run (hidden tab / rAF unavailable):
    // without it the leave Promise would never resolve, deadlocking anything
    // gated on it (e.g. route navigation via fromTransition(spring())).
    const snap = (): void => {
      if (settled) return
      settled = true
      for (const el of els) {
        el.style.setProperty(property, String(to))
      }
      cleanup()
      resolve()
    }

    const onVisibility = (): void => {
      if (isDocumentHidden()) snap()
    }

    // Apply initial value
    for (const el of els) {
      el.style.setProperty(property, String(from))
    }

    // No animation loop available (SSR / minimal jsdom) or the tab is already
    // hidden — settle immediately so the Promise always resolves.
    if (!rafAvailable || isDocumentHidden()) {
      snap()
      return
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    const state: SpringState = { position: from, velocity: 0 }
    let lastTime: number | null = null

    function step(time: number) {
      if (settled) return
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

      simulateSpring(state, to, stiffness, damping, mass, dt)

      for (const el of els) {
        el.style.setProperty(property, String(state.position))
      }

      if (isSettled(state, to, precision)) {
        snap()
        return
      }

      requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  })
}

/**
 * Spring-physics transition. Returns `{ enter, leave }` that animate a CSS
 * property using a damped spring simulation driven by `requestAnimationFrame`.
 *
 * When `requestAnimationFrame` can't drive the loop — server render, or a
 * hidden/background tab where rAF is paused — the animation settles instantly
 * to its target and the returned Promise still resolves. This matters for the
 * `leave` Promise: it gates DOM removal, so a spring leave in a hidden tab must
 * not hang (e.g. `fromTransition(spring())` route navigation).
 *
 * Consumed at the route/container seam via `fromTransition` in
 * `@llui/vike/client`. The signal `show`/`each`/`branch` primitives do **not**
 * currently accept transition hooks, so `show({ ...spring() })` is not yet
 * wired — that structural seam is a deferred cross-package change.
 */
export function spring(opts: SpringOptions = {}): TransitionOptions {
  const stiffness = opts.stiffness ?? 170
  const damping = opts.damping ?? 26
  const mass = opts.mass ?? 1
  const precision = opts.precision ?? 0.01
  const property = opts.property ?? 'opacity'
  const from = opts.from ?? 0
  const to = opts.to ?? 1

  const enter = (nodes: Node[]): void => {
    const els = asElements(nodes)
    void animateSpring(els, from, to, property, stiffness, damping, mass, precision)
  }

  const leave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    return animateSpring(els, to, from, property, stiffness, damping, mass, precision)
  }

  return { enter, leave }
}
