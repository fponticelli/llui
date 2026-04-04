import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'

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

  // Devtools: always dynamic import to avoid bundling in production.
  // In dev mode (import.meta.env.DEV), auto-enabled unless explicitly disabled.
  const meta = typeof import.meta !== 'undefined' ? import.meta : undefined
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isDev = meta && 'env' in meta && !!(meta as { env: { DEV?: boolean } }).env.DEV
  if (options?.devTools || (options?.devTools !== false && isDev)) {
    void import('./devtools').then((m) => m.installDevTools(inst))
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
  dispatchInitialEffects(inst)
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

function dispatchInitialEffects<S, M, E>(
  inst: ReturnType<typeof createComponentInstance<S, M, E>>,
): void {
  if (inst.initialEffects.length === 0 || !inst.def.onEffect) return
  for (const effect of inst.initialEffects) {
    inst.def.onEffect(effect, inst.send, inst.signal)
  }
  inst.initialEffects = []
}

export function hydrateApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  serverState: S,
): AppHandle {
  const hydrateDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [serverState, []],
  }

  const inst = createComponentInstance(hydrateDef)

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
