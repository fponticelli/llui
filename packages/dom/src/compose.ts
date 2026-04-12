/**
 * Type-level utilities + runtime helper for composing multiple child
 * component modules into a parent's State and Msg types.
 *
 * Eliminates the manual State/Msg union declarations for each embedded
 * sub-component. The developer declares the children map once, and
 * `ChildState` / `ChildMsg` derive the wrapper types.
 *
 * ```ts
 * import type { ChildState, ChildMsg } from '@llui/dom'
 * import { childHandlers } from '@llui/dom'
 * import { dialog } from '@llui/components/dialog'
 * import { sortable } from '@llui/components/sortable'
 *
 * const children = { dialog, sort: sortable } as const
 *
 * type State = ChildState<typeof children> & { items: string[] }
 * type Msg = ChildMsg<typeof children> | { type: 'addItem'; text: string }
 *
 * const update = mergeHandlers<State, Msg, never>(
 *   childHandlers(children),
 *   appUpdate,
 * )
 * ```
 */

/**
 * Extract the state type from a component module's update function.
 * Works with both property and method syntax.
 */
export type ModuleState<T> = T extends {
  update: (state: infer S, msg: infer _M) => [infer _S2, infer _E]
}
  ? S
  : never

/**
 * Extract the message type from a component module's update function.
 */
export type ModuleMsg<T> = T extends {
  update: (state: infer _S, msg: infer M) => [infer _S2, infer _E]
}
  ? M
  : never

/**
 * Given a record of component modules, derive the combined child state.
 * Each key maps to its module's state type.
 *
 * ```ts
 * const children = { dialog, sort: sortable } as const
 * type CS = ChildState<typeof children>
 * // → { dialog: DialogState; sort: SortableState }
 * ```
 */
export type ChildState<T extends Record<string, unknown>> = {
  [K in keyof T]: ModuleState<T[K]>
}

/**
 * Given a record of component modules, derive the combined child message
 * union. Each module's messages are wrapped in `{ type: key; msg: SubMsg }`.
 *
 * ```ts
 * const children = { dialog, sort: sortable } as const
 * type CM = ChildMsg<typeof children>
 * // → { type: 'dialog'; msg: DialogMsg } | { type: 'sort'; msg: SortableMsg }
 * ```
 */
export type ChildMsg<T extends Record<string, unknown>> = {
  [K in keyof T]: { type: K; msg: ModuleMsg<T[K]> }
}[keyof T]

/**
 * Create a merged handler from a map of component modules. Each module's
 * update is wired via `sliceHandler(key, module.update)` convention:
 * state[key] holds the sub-state, messages match `{ type: key; msg: SubMsg }`.
 *
 * Returns a handler compatible with `mergeHandlers`.
 */
export function childHandlers<S, M, E>(
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
