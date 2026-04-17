import type { ShowOptions } from '../types.js'
import { branch } from './branch.js'

const EMPTY = () => [] as Node[]

export function show<S, M = unknown>(opts: ShowOptions<S, M>): Node[] {
  // `__disposalCause` is read by branch.ts when it disposes the leaving
  // arm — it lets the disposer log distinguish show/hide transitions from
  // multi-case branch swaps.
  return branch<S, M>({
    on: opts.when,
    cases: { true: opts.render, false: opts.fallback ?? EMPTY },
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
    __disposalCause: 'show-hide',
  })
}
