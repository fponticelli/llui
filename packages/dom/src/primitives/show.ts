import type { ShowOptions } from '../types.js'
import { enterAccessor, exitAccessor } from '../render-context.js'
import { branch } from './branch.js'

const EMPTY = () => [] as Node[]

export function show<S, M = unknown>(opts: ShowOptions<S, M>): Node[] {
  // `__disposalCause` is read by branch.ts when it disposes the leaving
  // arm — it lets the disposer log distinguish show/hide transitions from
  // multi-case branch swaps.
  return branch<S, M>({
    // branch.on is string-only; stringify the boolean for the case lookup.
    // JS object literals stringify boolean keys, so `cases.{true, false}`
    // matches `String(true)` / `String(false)`.
    //
    // Label as `show().when` (not `branch().on`) so a sample() inside the
    // user's `when` callback yields an error pointing at the right surface.
    on: (s) => {
      enterAccessor('show().when')
      try {
        return String(opts.when(s))
      } finally {
        exitAccessor()
      }
    },
    cases: { true: opts.render, false: opts.fallback ?? EMPTY },
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
    __disposalCause: 'show-hide',
  })
}
