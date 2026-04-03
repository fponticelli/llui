import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'
// Static import — tree-shaken in prod when __DEV__ branch is eliminated
import { installDevTools } from './devtools'

// Vite replaces import.meta.env.DEV at build time; safe fallback for non-Vite
const __DEV__ =
  typeof import.meta !== 'undefined' &&
  !!(import.meta as unknown as Record<string, unknown>).env &&
  !!((import.meta as unknown as Record<string, unknown>).env as Record<string, boolean>).DEV

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

  // Dev: always on (unless explicitly disabled)
  // Prod: off by default, lazy-loaded on opt-in
  if (__DEV__) {
    if (options?.devTools !== false) {
      installDevTools(inst)
    }
  } else if (options?.devTools) {
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
