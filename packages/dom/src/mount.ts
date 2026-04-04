import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'
import { registerForHmr, unregisterForHmr, replaceComponent } from './hmr'
import { startHydration, endHydration } from './hydrate'

// Vite injects import.meta.env.DEV — declare the shape for TypeScript
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean }
  }
}

let hmrEnabled = false

/** Enable HMR state preservation. Called by the compiler's generated HMR code. */
export function enableHmr(): void {
  hmrEnabled = true
}

export interface MountOptions {
  devTools?: boolean
}

export function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: unknown,
  options?: MountOptions,
): AppHandle {
  // HMR: if this component is already mounted (module re-execution
  // during hot update), swap the definition instead of creating a new instance.
  if (hmrEnabled && def.name) {
    const swapped = replaceComponent(def.name, def)
    if (swapped) return swapped
  }

  const inst = createComponentInstance(def, data)

  // Devtools: auto-enabled in dev, opt-in in production.
  // Uses import.meta.env.DEV directly so Vite can dead-code-eliminate
  // the dynamic import('./devtools') in production builds.
  if (import.meta.env?.DEV ? options?.devTools !== false : options?.devTools) {
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
  if (hmrEnabled && def.name) {
    registerForHmr(def.name, inst, container)
  }
  dispatchInitialEffects(inst)
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      if (hmrEnabled && def.name) unregisterForHmr(def.name, inst)
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

  // Walk existing server HTML instead of clearing and re-creating
  startHydration(container)
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  hydrateDef.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)
  endHydration()

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
