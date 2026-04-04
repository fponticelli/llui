import type { ComponentDef, AppHandle } from './types'
import type { ComponentInstance } from './update-loop'
import { flushInstance } from './update-loop'
import { createScope, disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { unregisterInstance } from './runtime'
import { _setHmrModule } from './mount'

/**
 * Enable HMR state preservation. Called by compiler-generated dev code.
 * Importing this module registers it with mountApp for hot-swapping.
 */
export function enableHmr(): void {
  _setHmrModule({ enableHmr, registerForHmr, unregisterForHmr, replaceComponent })
}

// ── HMR Registry ─────────────────────────────────────────────────

interface HmrEntry {
  inst: ComponentInstance
  container: HTMLElement
}

const hmrRegistry = new Map<string, HmrEntry[]>()

export function registerForHmr(name: string, inst: object, container: HTMLElement): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ inst: inst as ComponentInstance, container })
  hmrRegistry.set(name, entries)
}

export function unregisterForHmr(name: string, inst: object): void {
  const entries = hmrRegistry.get(name)
  if (!entries) return
  const idx = entries.findIndex((e) => e.inst === inst)
  if (idx !== -1) entries.splice(idx, 1)
  if (entries.length === 0) hmrRegistry.delete(name)
}

/**
 * Hot-swap a component definition on all live instances.
 *
 * Preserves the current state. Replaces update, view, onEffect, and __dirty.
 * Disposes the old scope tree (removing old DOM and bindings),
 * re-runs view(currentState, send) to rebuild fresh DOM.
 *
 * Returns an AppHandle for the first instance (for mountApp compatibility),
 * or null if no instances are registered (first mount).
 */
export function replaceComponent<S, M, E>(
  name: string,
  newDef: ComponentDef<S, M, E>,
): AppHandle | null {
  const entries = hmrRegistry.get(name)
  if (!entries || entries.length === 0) return null

  let handle: AppHandle | null = null

  for (const { inst, container } of entries) {
    const typedInst = inst as ComponentInstance<S, M, E>

    // Replace functions on the live definition
    typedInst.def = {
      ...typedInst.def,
      update: newDef.update,
      view: newDef.view,
      onEffect: newDef.onEffect,
      __dirty: newDef.__dirty,
    }

    // Dispose old scope tree — removes all old DOM nodes and bindings
    disposeScope(typedInst.rootScope)
    container.textContent = ''

    // Create fresh scope tree
    typedInst.rootScope = createScope(null)
    typedInst.allBindings = []
    typedInst.structuralBlocks = []

    // Re-run view with current state
    setFlatBindings(typedInst.allBindings)
    setRenderContext({
      rootScope: typedInst.rootScope,
      state: typedInst.state,
      allBindings: typedInst.allBindings,
      structuralBlocks: typedInst.structuralBlocks,
      container,
      send: typedInst.send as (msg: unknown) => void,
    })
    const nodes = typedInst.def.view(typedInst.state, typedInst.send)
    clearRenderContext()
    setFlatBindings(null)

    for (const node of nodes) {
      container.appendChild(node)
    }

    // Return AppHandle for the first instance
    if (!handle) {
      handle = {
        dispose() {
          unregisterForHmr(name, inst)
          inst.abortController.abort()
          unregisterInstance(inst)
          disposeScope(typedInst.rootScope)
          container.textContent = ''
        },
        flush() {
          flushInstance(inst)
        },
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[LLui HMR] ${name} updated — state preserved`)

  return handle
}
