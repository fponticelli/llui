import type { ShowOptions } from '../types'
import { branch } from './branch'

export function show<S>(opts: ShowOptions<S>): Node[] {
  return branch({
    on: (s: S) => opts.when(s),
    cases: {
      true: opts.render,
      false: () => [],
    },
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
  })
}
