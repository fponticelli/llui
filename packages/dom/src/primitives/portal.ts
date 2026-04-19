import type { PortalOptions } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime, addDisposer } from '../lifetime.js'

export function portal(opts: PortalOptions): Node[] {
  const ctx = getRenderContext('portal')
  const parentLifetime = ctx.rootLifetime

  // `DomEnv.querySelector` is a required method — see dom-env.ts.
  // Custom envs that don't implement it fail TS compile; at runtime
  // every LLui-shipped env resolves against its own document, which
  // keeps portal safe on both client and SSR (returns `null` →
  // no-op when the target is unreachable).
  const target = typeof opts.target === 'string' ? ctx.dom.querySelector(opts.target) : opts.target

  if (!target) {
    return []
  }

  const portalScope = createLifetime(parentLifetime)
  portalScope._kind = 'portal'
  const buildCtx = { ...ctx, rootLifetime: portalScope, container: target as Element }
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
