import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'

// Vite injects import.meta.env.DEV — declare the shape for TypeScript
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean }
  }
}

// ── HMR (dev only) ──────────────────────────────────────────────
// Set by enableHmr() from '@llui/dom/hmr' — never imported in production.

let hmrModule: typeof import('./hmr') | null = null

/** @internal Called by enableHmr in the hmr module */
export function _setHmrModule(m: typeof import('./hmr')): void {
  hmrModule = m
}

export interface MountOptions {
  devTools?: boolean
}

export function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  _options?: MountOptions,
): AppHandle {
  // HMR: if this component is already mounted (module re-execution
  // during hot update), swap the definition instead of creating a new instance.
  if (hmrModule && def.name) {
    const swapped = hmrModule.replaceComponent(def.name, def)
    if (swapped) return swapped
  }

  const inst = createComponentInstance(def, data)

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
  if (hmrModule && def.name) {
    hmrModule.registerForHmr(def.name, inst, container)
  }
  dispatchInitialEffects(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (hmrModule && def.name) hmrModule.unregisterForHmr(def.name, inst)
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

  // Build the component DOM and swap atomically with server HTML.
  // Server HTML remains visible until JS finishes — no flash.
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = hydrateDef.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)

  // Atomic swap — replaces server HTML with client DOM in one operation
  container.replaceChildren(...nodes)

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
