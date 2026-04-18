import type { ScopeOptions } from '../types.js'
import { branch } from './branch.js'

/**
 * Rebuild a subtree when `on(state)` changes.
 *
 * The `render` callback runs once at mount and once again every time
 * `on(state)` returns a new value (compared with `Object.is`). Each run
 * gets a fresh `Lifetime`, so bindings, onMount callbacks, and any
 * per-arm state are recreated cleanly. Use `sample()` inside `render`
 * when you need to read a whole-state snapshot at rebuild time without
 * creating a reactive binding.
 *
 * Sugar over `branch({ on, cases: {}, default: render, __disposalCause: 'scope-rebuild' })`.
 *
 * ```ts
 * scope({
 *   on: (s) => String(s.chartEpoch),
 *   render: (h) => {
 *     const stats = sample<State, Stats>((s) => s.stats)
 *     return [chartView(h, stats)]
 *   },
 * })
 * ```
 */
export function scope<S, M = unknown>(opts: ScopeOptions<S, M>): Node[] {
  return branch<S, M>({
    on: opts.on,
    cases: {},
    default: opts.render,
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
    __disposalCause: 'scope-rebuild',
    __mask: opts.__mask,
  })
}
