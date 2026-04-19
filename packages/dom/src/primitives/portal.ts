import type { PortalOptions } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime, addDisposer } from '../lifetime.js'

export function portal(opts: PortalOptions): Node[] {
  const ctx = getRenderContext('portal')
  const parentLifetime = ctx.rootLifetime

  // Resolve a string target against the current env's document.
  // `ctx.dom.querySelector` is present on every env shipped by
  // `@llui/dom` (browserEnv, jsdomEnv, linkedomEnv). For a user-built
  // env that predates this method we fall back to `globalThis.document`,
  // and if THAT is also absent — which is exactly the Cloudflare
  // Workers + linkedom-with-stale-env case portal used to crash on —
  // we return [] instead of throwing. Portal is a client concept; SSR
  // silently skipping the resolution is the right "no-op" behavior.
  let target: Element | null = null
  if (typeof opts.target === 'string') {
    if (ctx.dom.querySelector) {
      target = ctx.dom.querySelector(opts.target)
    } else if (typeof document !== 'undefined') {
      target = document.querySelector(opts.target)
    }
  } else {
    target = opts.target
  }

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
