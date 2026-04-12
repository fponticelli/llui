import { getRenderContext } from '../render-context'
import { addDisposer } from '../scope'

export function onMount(callback: (el: Element) => (() => void) | void): void {
  // No-op on the server — event listeners and DOM callbacks are client-only
  if (typeof window === 'undefined') return

  const ctx = getRenderContext('onMount')
  const scope = ctx.rootScope
  const container = ctx.container ?? document.body
  let cancelled = false

  addDisposer(scope, () => {
    cancelled = true
  })

  queueMicrotask(() => {
    if (cancelled) return
    const cleanup = callback(container)
    if (typeof cleanup === 'function') {
      addDisposer(scope, cleanup)
    }
  })
}
