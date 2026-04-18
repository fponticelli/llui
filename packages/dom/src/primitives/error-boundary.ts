import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime, disposeLifetime } from '../lifetime.js'

export function errorBoundary(opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[] {
  const ctx = getRenderContext('errorBoundary')
  const parentLifetime = ctx.rootLifetime
  const childLifetime = createLifetime(parentLifetime)

  try {
    const buildCtx = { ...ctx, rootLifetime: childLifetime }
    setRenderContext(buildCtx)
    const nodes = opts.render()
    clearRenderContext()
    setRenderContext(ctx)
    return nodes
  } catch (thrown) {
    // Clean up the partially-created scope
    disposeLifetime(childLifetime)

    const error = thrown instanceof Error ? thrown : new Error(String(thrown))

    if (opts.onError) {
      opts.onError(error)
    }

    // Build fallback in a fresh scope
    const fallbackScope = createLifetime(parentLifetime)
    const fallbackCtx = { ...ctx, rootLifetime: fallbackScope }
    setRenderContext(fallbackCtx)
    const fallbackNodes = opts.fallback(error)
    clearRenderContext()
    setRenderContext(ctx)
    return fallbackNodes
  }
}
