import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'
import { installDevTools } from './devtools'

export interface MountOptions {
  devTools?: boolean
}

export function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  options?: MountOptions,
): AppHandle {
  const inst = createComponentInstance(def, data)

  if (options?.devTools) {
    installDevTools(inst)
  }

  // Run view() within a render context so primitives can register bindings
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = def.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)

  for (const node of nodes) {
    container.appendChild(node)
  }

  registerInstance(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      inst.abortController.abort()
      unregisterInstance(inst)
      disposeScope(inst.rootScope)
      container.textContent = ''
    },
    flush() {
      if (disposed) return
      flushInstance(inst)
    },
  }
}

export function hydrateApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  serverState: S,
): AppHandle {
  // Override init to use the server-provided state
  const hydrateDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [serverState, []],
  }

  const inst = createComponentInstance(hydrateDef)

  // Clear server HTML and mount fresh — the view produces identical DOM
  // A true walk-and-attach hydration is a v2 optimization
  container.textContent = ''

  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = hydrateDef.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)

  for (const node of nodes) {
    container.appendChild(node)
  }

  registerInstance(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      inst.abortController.abort()
      unregisterInstance(inst)
      disposeScope(inst.rootScope)
      container.textContent = ''
    },
    flush() {
      if (disposed) return
      flushInstance(inst)
    },
  }
}
