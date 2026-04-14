import type { Scope } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createScope } from '../scope.js'

/**
 * Per-scope storage: scope → (context-id → accessor).
 * WeakMap so disposed scopes are GC'd.
 */
const contextMap = new WeakMap<Scope, Map<symbol, (s: unknown) => unknown>>()

export interface Context<T> {
  readonly _id: symbol
  readonly _default: T | undefined
  readonly _name: string | undefined
}

/**
 * Create a typed context key. Pass a default value to make consumers without a
 * provider resolve to it; omit to make unprovided consumption throw.
 *
 * ```ts
 * const ThemeContext = createContext<'light' | 'dark'>('light')
 * ```
 */
export function createContext<T>(defaultValue?: T, name?: string): Context<T> {
  return { _id: Symbol(name ?? 'llui-ctx'), _default: defaultValue, _name: name }
}

/**
 * Provide a reactive value for `ctx` to every descendant rendered inside `children`.
 * The accessor `(s: S) => T` is evaluated lazily at binding read time, so providers
 * can thread state slices down without prop drilling.
 *
 * ```ts
 * view: ({ send }) => [
 *   provide(ThemeContext, (s: State) => s.theme, () => [
 *     header(send),
 *     main(send),
 *   ]),
 * ]
 * ```
 *
 * Nested providers shadow outer ones within their subtree. The outer value is
 * restored after `children()` returns, so sibling subtrees aren't affected.
 */
export function provide<S, T>(
  ctx: Context<T>,
  accessor: (s: S) => T,
  children: () => Node[],
): Node[] {
  const renderCtx = getRenderContext('provide')
  const parentScope = renderCtx.rootScope
  // Create a sub-scope so the context is attached to THIS provider alone.
  // Descendants (including those mounted later via show/branch/each) walk
  // up to this scope via their own parent chain and find the accessor.
  // Nested providers create their own sub-scope, shadowing outer values.
  const providerScope = createScope(parentScope)
  const map = new Map<symbol, (s: unknown) => unknown>()
  map.set(ctx._id, accessor as (s: unknown) => unknown)
  contextMap.set(providerScope, map)
  // Render children with the provider scope as the new rootScope so any
  // primitives (bindings, structural blocks, nested providers) attach here.
  setRenderContext({ ...renderCtx, rootScope: providerScope })
  try {
    return children()
  } finally {
    clearRenderContext()
    setRenderContext(renderCtx)
  }
}

/**
 * Read a context accessor within a view or view-function. Walks the scope chain
 * from the current render point to find the nearest provider. Returns an
 * `(s: S) => T` accessor that can be passed to bindings (text/class/etc.).
 *
 * ```ts
 * export function themedCard(): Node[] {
 *   const theme = useContext(ThemeContext)
 *   return div({ class: (s) => `card theme-${theme(s)}` }, [...])
 * }
 * ```
 */
export function useContext<S, T>(ctx: Context<T>): (s: S) => T {
  let scope: Scope | null = null
  try {
    scope = getRenderContext('useContext').rootScope
  } catch {
    // No render context (e.g. called from connect() in a unit test).
    // Fall through to default resolution below.
  }
  while (scope) {
    const map = contextMap.get(scope)
    if (map?.has(ctx._id)) {
      const accessor = map.get(ctx._id)!
      return accessor as (s: S) => T
    }
    scope = scope.parent
  }
  if (ctx._default !== undefined) {
    const d = ctx._default
    return () => d
  }
  const label = ctx._name ?? ctx._id.description ?? 'unknown'
  throw new Error(
    `[LLui] useContext(${label}): no provider found and no default value. ` +
      `Wrap a parent element with provide(${label}, accessor, () => [...]) ` +
      `or pass a default to createContext().`,
  )
}
