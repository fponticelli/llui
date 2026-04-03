import type { PortalOptions } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, addDisposer } from '../scope'

export function portal(opts: PortalOptions): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope

  const target =
    typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target

  if (!target) {
    return []
  }

  const portalScope = createScope(parentScope)
  const buildCtx = { ...ctx, rootScope: portalScope, container: target as Element }
  setRenderContext(buildCtx)
  const nodes = opts.render()
  clearRenderContext()
  // Restore parent context
  setRenderContext(ctx)

  for (const node of nodes) {
    target.appendChild(node)
  }

  // On scope disposal, remove portal nodes from target
  addDisposer(portalScope, () => {
    for (const node of nodes) {
      if (node.parentNode === target) {
        target.removeChild(node)
      }
    }
  })

  // Portal returns nothing to the parent DOM — nodes live in the target
  return []
}
