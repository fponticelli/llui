import { component, type SignalComponentDef } from '@llui/dom'

export interface ReducerOptions<S, M, E = never> {
  init: () => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  name?: string
}

/**
 * Builds a view-less `ComponentDef` from an init + update pair so reducer
 * suites can drop a component definition into `testComponent()` without
 * padding a no-op `view`. Use when a test only exercises pure state
 * transitions (no DOM, no accessors).
 *
 * The default name `'__reducer__'` is intentionally unergonomic — it
 * shows up in devtools/HMR registries if one ever leaks into a real
 * mount, flagging the mistake. Override via `name` when you want the
 * history trail to match your module.
 */
export function reducer<S, M, E = never>(
  opts: ReducerOptions<S, M, E>,
): SignalComponentDef<S, M, E> {
  return component<S, M, E>({
    name: opts.name ?? '__reducer__',
    init: opts.init,
    update: opts.update,
    view: () => [],
  })
}
