import type { ComponentDef, LazyDef } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createScope, disposeScope, addDisposer } from '../scope.js'
import { createComponentInstance } from '../update-loop.js'
import { setFlatBindings } from '../binding.js'
import { createView, type View } from '../view-helpers.js'

export interface LazyOptions<S, M, D> {
  /** Async loader — typically `() => import('./MyComponent').then(m => m.default)`. */
  loader: () => Promise<LazyDef<D>>
  /** Nodes to render while loading. */
  fallback: (h: View<S, M>) => Node[]
  /** Nodes to render if the loader rejects. */
  error?: (err: Error, h: View<S, M>) => Node[]
  /** Props passed as init data to the loaded component. Evaluated once at resolution. */
  data?: (s: S) => D
}

/**
 * Load a component asynchronously. Renders `fallback` immediately, then swaps
 * in the loaded component when the loader's Promise resolves. If the loader
 * rejects, renders `error` (or nothing if no error handler is provided).
 *
 * ```ts
 * view: ({ text }) => [
 *   ...lazy({
 *     loader: () => import('./Chart').then(m => m.default),
 *     fallback: ({ text }) => [div([text('Loading chart...')])],
 *     error: (err, { text }) => [div([text(`Failed: ${err.message}`)])],
 *   }),
 * ]
 * ```
 *
 * The loaded component's S, M, E types are internal — `lazy()` only needs
 * the `D` (init data) type to match. `LazyDef<D>` is a type-erased shape
 * that any `ComponentDef<S, M, E, D>` satisfies structurally, avoiding the
 * `View<S, M>` invariance trap that would otherwise require user-side casts.
 *
 * If the parent scope is disposed before the loader resolves, the load is
 * cancelled — the loaded component is never mounted.
 */
export function lazy<S, M, D = undefined>(opts: LazyOptions<S, M, D>): Node[] {
  const ctx = getRenderContext('lazy')
  const parentScope = ctx.rootScope
  const send = ctx.send as (msg: M) => void

  // Anchor marks the insertion point; fallback nodes live between anchor and endAnchor
  const startAnchor = document.createComment('lazy')
  const endAnchor = document.createComment('/lazy')

  // Build fallback inside its own sub-scope (disposed when we swap in loaded component)
  let currentScope = createScope(parentScope)
  setRenderContext({ ...ctx, rootScope: currentScope })
  let currentNodes = opts.fallback(createView<S, M>(send))
  clearRenderContext()
  setRenderContext(ctx)

  let cancelled = false
  addDisposer(parentScope, () => {
    cancelled = true
  })

  const swap = (buildNew: () => Node[]): void => {
    if (cancelled) return
    const parent = startAnchor.parentNode
    if (!parent) return

    // Dispose old sub-scope (removes fallback bindings/listeners)
    if (currentScope) disposeScope(currentScope)
    for (const node of currentNodes) {
      if (node.parentNode === parent) parent.removeChild(node)
    }

    // Build new nodes in a fresh sub-scope
    currentScope = createScope(parentScope)
    setRenderContext({ ...ctx, rootScope: currentScope })
    currentNodes = buildNew()
    clearRenderContext()
    setRenderContext(ctx)

    // Insert after startAnchor (before endAnchor)
    for (const node of currentNodes) {
      parent.insertBefore(node, endAnchor)
    }
  }

  // Kick off the loader
  opts
    .loader()
    .then((def) => {
      if (cancelled) return
      swap(() => {
        // Mount loaded component as a nested instance (similar to child()).
        // Cast LazyDef back to ComponentDef — safe because the loader
        // returned a real ComponentDef; LazyDef only erased the types.
        const initialProps = opts.data ? opts.data(ctx.state as S) : undefined
        const childInst = createComponentInstance(
          def as unknown as ComponentDef<unknown, unknown, unknown>,
          initialProps,
        )

        // Render the loaded component's view inside its own render context
        setFlatBindings(childInst.allBindings)
        setRenderContext({
          ...childInst,
          send: childInst.send as (msg: unknown) => void,
        })
        const nodes = (def as { view: (h: unknown) => Node[] }).view(createView(childInst.send))
        clearRenderContext()
        setFlatBindings(ctx.allBindings)
        setRenderContext(ctx)

        // Dispose the loaded instance when our current sub-scope disposes
        addDisposer(currentScope, () => {
          disposeScope(childInst.rootScope)
        })

        return nodes
      })
    })
    .catch((err: unknown) => {
      if (cancelled) return
      if (!opts.error) return
      const e = err instanceof Error ? err : new Error(String(err))
      swap(() => opts.error!(e, createView<S, M>(send)))
    })

  return [startAnchor, ...currentNodes, endAnchor]
}
