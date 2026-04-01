import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'

export function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: unknown,
): AppHandle {
  const inst = createComponentInstance(def, data)

  // Run view() within a render context so primitives can register bindings
  setRenderContext({ ...inst, container })
  const nodes = def.view(inst.state, inst.send)
  clearRenderContext()

  for (const node of nodes) {
    container.appendChild(node)
  }

  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
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
  _container: HTMLElement,
  _def: ComponentDef<S, M, E>,
  _serverState: S,
): AppHandle {
  throw new Error('hydrateApp not yet implemented')
}
