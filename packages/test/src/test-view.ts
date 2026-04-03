import type { ComponentDef } from '@llui/dom'
import { mountApp } from '@llui/dom'

export interface ViewQuery {
  query: (selector: string) => Element | null
  queryAll: (selector: string) => Element[]
}

export function testView<S, M, E>(def: ComponentDef<S, M, E>, state: S): ViewQuery {
  // Create a temporary container and mount the component with the given state
  const container = document.createElement('div')

  // Override init to return the provided state
  const testDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [state, []],
  }

  mountApp(container, testDef)

  return {
    query: (selector: string) => container.querySelector(selector),
    queryAll: (selector: string) => Array.from(container.querySelectorAll(selector)),
  }
}
