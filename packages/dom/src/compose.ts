/**
 * Type-level utilities + runtime helper for composing multiple sub-module
 * reducers into a parent's State and Msg types.
 *
 * Eliminates the manual State/Msg union declarations for each embedded
 * module. The developer declares the modules map once, and
 * `ModulesState` / `ModulesMsg` derive the wrapper types.
 *
 * ```ts
 * import type { ModulesState, ModulesMsg } from '@llui/dom'
 * import { composeModules } from '@llui/dom'
 * import { dialog } from '@llui/components/dialog'
 * import { sortable } from '@llui/components/sortable'
 *
 * const modules = { dialog, sort: sortable } as const
 *
 * type State = ModulesState<typeof modules> & { items: string[] }
 * type Msg = ModulesMsg<typeof modules> | { type: 'addItem'; text: string }
 *
 * const update = mergeHandlers<State, Msg, never>(
 *   composeModules(modules),
 *   appUpdate,
 * )
 * ```
 *
 * Pairs with `mergeHandlers` (this stack) when embedded modules emit
 * bare messages — typically components from `@llui/components` or
 * third-party packages whose `update` shape you don't control. When you
 * own the slice's message shape, prefer `combine()` with slash-routing
 * (`{type: 'slice/action'}`) instead.
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
 * Given a record of component modules, derive the combined sub-state.
 * Each key maps to its module's state type.
 *
 * ```ts
 * const modules = { dialog, sort: sortable } as const
 * type S = ModulesState<typeof modules>
 * // → { dialog: DialogState; sort: SortableState }
 * ```
 */
export type ModulesState<T extends Record<string, unknown>> = {
  [K in keyof T]: ModuleState<T[K]>
}

/**
 * Given a record of component modules, derive the combined message
 * union. Each module's messages are wrapped in `{ type: key; msg: SubMsg }`.
 *
 * ```ts
 * const modules = { dialog, sort: sortable } as const
 * type M = ModulesMsg<typeof modules>
 * // → { type: 'dialog'; msg: DialogMsg } | { type: 'sort'; msg: SortableMsg }
 * ```
 */
export type ModulesMsg<T extends Record<string, unknown>> = {
  [K in keyof T]: { type: K; msg: ModuleMsg<T[K]> }
}[keyof T]

/**
 * Create a merged handler from a map of component modules. Each module's
 * update is wired via the convention: state[key] holds the sub-state,
 * messages match `{ type: key; msg: SubMsg }`.
 *
 * Returns a handler compatible with `mergeHandlers`.
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
