import type { ShowOptions } from '../types'
import { branch } from './branch'

const EMPTY = () => [] as Node[]

export function show<S, M = unknown>(opts: ShowOptions<S, M>): Node[] {
  return branch<S, M>({
    on: opts.when,
    cases: { true: opts.render, false: EMPTY },
    enter: opts.enter,
    leave: opts.leave,
    onTransition: opts.onTransition,
  })
}
