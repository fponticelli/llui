import type { ShowOptions } from '../types'
import { branch } from './branch'

const EMPTY: () => Node[] = () => []

export function show<S>(opts: ShowOptions<S>): Node[] {
  return branch({
    on: opts.when,
    cases: { true: opts.render, false: EMPTY },
  })
}
