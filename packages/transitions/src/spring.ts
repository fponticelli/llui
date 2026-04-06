import type { TransitionOptions } from '@llui/dom'
import { asElements } from './style-utils'

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

  return new Promise<void>((resolve) => {
    const state: SpringState = { position: from, velocity: 0 }
    let lastTime: number | null = null

    function step(time: number) {
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
        // Snap to exact target
        for (const el of els) {
          el.style.setProperty(property, String(to))
        }
        resolve()
        return
      }

      requestAnimationFrame(step)
    }

    // Apply initial value
    for (const el of els) {
      el.style.setProperty(property, String(from))
    }

    requestAnimationFrame(step)
  })
}

/**
 * Spring-physics transition. Returns `{ enter, leave }` that animate a CSS
 * property using a damped spring simulation driven by `requestAnimationFrame`.
 *
 * ```ts
 * show({ when: (s) => s.open, render: () => content(), ...spring() })
 * show({ ...spring({ property: 'transform', from: 0, to: 1 }) })
 * ```
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
