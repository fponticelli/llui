import type { ComponentDef } from './types'

export function component<S, M, E = never, D = void>(
  def: ComponentDef<S, M, E, D>,
): ComponentDef<S, M, E, D> {
  return def
}
