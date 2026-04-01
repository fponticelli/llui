import type { ComponentDef } from '@llui/core'

export interface ViewQuery {
  query: (selector: string) => Element | null
  queryAll: (selector: string) => Element[]
}

export function testView<S, M, E>(_def: ComponentDef<S, M, E>, _state: S): ViewQuery {
  // TODO: implement with lightweight DOM shim
  throw new Error('testView not yet implemented')
}
