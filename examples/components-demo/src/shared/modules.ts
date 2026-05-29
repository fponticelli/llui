/**
 * Local copy of the module-composition helpers.
 *
 * These are pure data/type utilities — they compose `(state, msg) => [state,
 * effects]` reducers, with no dependency on any runtime. They live here (rather
 * than being imported from a package) so the demo stays on the signal surface
 * (`@llui/dom/signals`) without pulling the legacy `@llui/dom` entry.
 */

/** Extract the state type from a component module's update function. */
export type ModuleState<T> = T extends {
  update: (state: infer S, msg: infer _M) => [infer _S2, infer _E]
}
  ? S
  : never

/** Extract the message type from a component module's update function. */
export type ModuleMsg<T> = T extends {
  update: (state: infer _S, msg: infer M) => [infer _S2, infer _E]
}
  ? M
  : never

/** Combined sub-state: each key maps to its module's state type. */
export type ModulesState<T extends Record<string, unknown>> = {
  [K in keyof T]: ModuleState<T[K]>
}

/** Combined message union: each module's messages wrapped as `{ type: key; msg }`. */
export type ModulesMsg<T extends Record<string, unknown>> = {
  [K in keyof T]: { type: K; msg: ModuleMsg<T[K]> }
}[keyof T]

/**
 * Create a merged handler from a map of component modules. `state[key]` holds
 * the sub-state; messages match `{ type: key; msg: SubMsg }`. Returns a handler
 * compatible with `mergeHandlers`.
 */
export function composeModules<S, M, E>(
  modules: Record<string, { update: (state: never, msg: never) => [unknown, unknown[]] }>,
): (state: S, msg: M) => [S, E[]] | null {
  const keys = Object.keys(modules)
  return (state, msg) => {
    const m = msg as { type: string; msg?: unknown }
    if (!m.type || !('msg' in m)) return null
    if (!keys.includes(m.type)) return null
    const mod = modules[m.type]!
    const slice = (state as Record<string, unknown>)[m.type]
    const [nextSlice, effects] = mod.update(slice as never, m.msg as never)
    return [{ ...state, [m.type]: nextSlice } as S, effects as E[]]
  }
}

/**
 * Compose multiple update handlers into one. Each handler returns
 * `[newState, effects]` if it handled the message, or `null` to pass through.
 * The first handler that returns non-null wins.
 */
export function mergeHandlers<S, M, E>(
  ...handlers: Array<(state: S, msg: M) => [S, E[]] | null>
): (state: S, msg: M) => [S, E[]] {
  return (state, msg) => {
    for (const handler of handlers) {
      const result = handler(state, msg)
      if (result) return result
    }
    return [state, []]
  }
}
