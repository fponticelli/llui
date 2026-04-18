import type { Lifetime } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime } from '../lifetime.js'

/**
 * Per-scope storage: scope → (context-id → accessor).
 * WeakMap so disposed scopes are GC'd.
 */
const contextMap = new WeakMap<Lifetime, Map<symbol, (s: unknown) => unknown>>()

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
  const parentLifetime = renderCtx.rootLifetime
  // Create a sub-scope so the context is attached to THIS provider alone.
  // Descendants (including those mounted later via show/branch/each) walk
  // up to this scope via their own parent chain and find the accessor.
  // Nested providers create their own sub-scope, shadowing outer values.
  const providerScope = createLifetime(parentLifetime)
  const map = new Map<symbol, (s: unknown) => unknown>()
  map.set(ctx._id, accessor as (s: unknown) => unknown)
  contextMap.set(providerScope, map)
  // Render children with the provider scope as the new rootLifetime so any
  // primitives (bindings, structural blocks, nested providers) attach here.
  setRenderContext({ ...renderCtx, rootLifetime: providerScope })
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
  let scope: Lifetime | null = null
  try {
    scope = getRenderContext('useContext').rootLifetime
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

/**
 * Provide a state-independent value to every descendant. Companion to
 * `provide()` for the common case of publishing a stable dispatcher
 * bag, callback record, or DI container — anything that doesn't depend
 * on the parent's state.
 *
 * ```ts
 * provideValue(ToastContext, { show: (m) => send({ type: 'toast', m }) }, () => [
 *   main([pageSlot()]),
 * ])
 * ```
 *
 * Equivalent to `provide(ctx, () => value, children)`, but exists so
 * the call site reads as "provide this value" rather than "provide an
 * accessor that ignores its state argument and returns a value." Pair
 * with `useContextValue` for symmetric ergonomics on the consumer side.
 *
 * Internally still uses the accessor mechanism: the value is wrapped
 * in a constant lambda. Consumers that read via the reactive
 * `useContext` form will get an `(s) => T` whose accessor ignores `s`.
 */
export function provideValue<T>(ctx: Context<T>, value: T, children: () => Node[]): Node[] {
  return provide(ctx, () => value, children)
}

/**
 * Read a state-independent value from the nearest provider. Companion
 * to `useContext()` for the common case of consuming a stable
 * dispatcher bag, callback record, or DI container.
 *
 * ```ts
 * const toast = useContextValue(ToastContext)
 * button({ onClick: () => toast.show('Saved') }, [text('Save')])
 * ```
 *
 * Equivalent to calling the accessor returned by `useContext` with
 * `undefined`, but reads as a single function call instead of a
 * three-step "look up the accessor, ignore the state arg, get the
 * value" dance.
 *
 * ## Value capture contract
 *
 * **The returned value is captured once, at view-construction time.**
 * Any reference you store from `useContextValue(ctx)` into a closure
 * — for example, by assigning it to a local `const` inside `view(...)`
 * and reading it from an event handler — sees the value as it was
 * when the view ran. The closure does NOT re-read the context on each
 * event dispatch.
 *
 * That's fine, and usually what you want, for stable dispatcher bags:
 * the bag's methods close over the layout's `send`, and `send` itself
 * is stable across the layout's lifetime, so the methods work
 * correctly regardless of when the handler fires. Pages can stash
 * `const toast = useContextValue(ToastContext)` at the top of their
 * `view()` and call `toast.show(...)` from any event handler below.
 *
 * **Do NOT use `useContextValue` when the consumer needs to see
 * updates to the context value.** If a parent re-`provideValue`s the
 * context with a different object later, existing consumers already
 * holding the captured value will still see the old one. For
 * reactive consumption, use `useContext(ctx)` — that returns an
 * accessor that re-reads the provider on each binding evaluation, so
 * reactive bindings (`class`, `text`, etc.) pick up updates
 * automatically.
 *
 * **Do NOT use `useContextValue` against a provider whose accessor
 * reads from state.** The accessor is invoked with `undefined` here,
 * so any `(s) => s.something` provider will throw or return garbage.
 * Match `provideValue` on the producer side with `useContextValue` on
 * the consumer side, and `provide` with `useContext`.
 */
export function useContextValue<T>(ctx: Context<T>): T {
  const accessor = useContext<unknown, T>(ctx)
  // The contract above: the producer side promised this accessor
  // doesn't read its state arg. Pass undefined.
  return accessor(undefined)
}
