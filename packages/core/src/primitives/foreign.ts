import type { ForeignOptions } from '../types'

export function foreign<S, T extends Record<string, unknown>, Instance>(
  _opts: ForeignOptions<S, T, Instance>,
): Node[] {
  // TODO: implement
  throw new Error('foreign not yet implemented')
}
