import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'

export function errorBoundary(opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope
  const childScope = createScope(parentScope)

  try {
    const buildCtx = { ...ctx, rootScope: childScope }
    setRenderContext(buildCtx)
    const nodes = opts.render()
    clearRenderContext()
    setRenderContext(ctx)
    return nodes
  } catch (thrown) {
    // Clean up the partially-created scope
    disposeScope(childScope)

    const error = thrown instanceof Error ? thrown : new Error(String(thrown))

    if (opts.onError) {
      opts.onError(error)
    }

    // Build fallback in a fresh scope
    const fallbackScope = createScope(parentScope)
    const fallbackCtx = { ...ctx, rootScope: fallbackScope }
    setRenderContext(fallbackCtx)
    const fallbackNodes = opts.fallback(error)
    clearRenderContext()
    setRenderContext(ctx)
    return fallbackNodes
  }
}
