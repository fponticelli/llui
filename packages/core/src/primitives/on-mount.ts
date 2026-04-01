import { getRenderContext } from '../render-context'

export function onMount(callback: (el: Element) => (() => void) | void): void {
  const ctx = getRenderContext()
  const scope = ctx.rootScope
  const container = ctx.container ?? document.body
  let cancelled = false

  scope.disposers.push(() => {
    cancelled = true
  })

  queueMicrotask(() => {
    if (cancelled) return
    const cleanup = callback(container)
    if (typeof cleanup === 'function') {
      scope.disposers.push(cleanup)
    }
  })
}
