import type { ComponentDef } from './types'

export function component<S, M, E>(def: ComponentDef<S, M, E>): ComponentDef<S, M, E> {
  return def
}
