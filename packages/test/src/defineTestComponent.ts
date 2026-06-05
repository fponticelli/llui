// Test-component builder for the signal runtime.
//
// The signal runtime has no `__compilerVersion` gate (that was a legacy-runtime
// concept), so building a test component is just `component(...)`. This helper
// stays in the public surface so consumers reach for `@llui/test` rather than
// the signal authoring barrel directly, and so the shape matches the other
// reducer-driving harnesses.

import { component, type SignalComponentDef } from '@llui/dom'
import type { SignalViewBag, Renderable } from '@llui/dom'

export interface DefineTestComponentInput<
  S,
  M extends { type: string },
  E extends { type: string } = never,
> {
  name: string
  init: () => [S, E[]] | S
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: SignalViewBag<S, M>) => Renderable
  onEffect?: SignalComponentDef<S, M, E>['onEffect']
}

export function defineTestComponent<
  S,
  M extends { type: string },
  E extends { type: string } = never,
>(input: DefineTestComponentInput<S, M, E>): SignalComponentDef<S, M, E> {
  return component<S, M, E>({
    name: input.name,
    init: input.init,
    update: input.update,
    view: input.view,
    ...(input.onEffect ? { onEffect: input.onEffect } : {}),
  })
}
