import type { ComponentDef, AppHandle } from './types.js'
import type { ComponentInstance } from './update-loop.js'
import { flushInstance } from './update-loop.js'
import { createLifetime, disposeLifetime } from './lifetime.js'
import { setRenderContext, clearRenderContext } from './render-context.js'
import { setFlatBindings } from './binding.js'
import { unregisterInstance } from './runtime.js'
import { _setHmrModule } from './mount.js'
import { createView } from './view-helpers.js'

/**
 * Enable HMR state preservation. Called by compiler-generated dev code.
 * Importing this module registers it with mountApp for hot-swapping.
 */
export function enableHmr(): void {
  _setHmrModule({
    enableHmr,
    registerForHmr,
    registerForAnchor,
    unregisterForHmr,
    replaceComponent,
  })
}

// ── HMR Registry ─────────────────────────────────────────────────

type HmrEntry =
  | {
      kind: 'container'
      inst: ComponentInstance
      container: HTMLElement
    }
  | {
      kind: 'anchor'
      inst: ComponentInstance
      anchor: Comment
      endSentinel: Comment
    }

const hmrRegistry = new Map<string, HmrEntry[]>()

export function registerForHmr(name: string, inst: object, container: HTMLElement): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'container', inst: inst as ComponentInstance, container })
  hmrRegistry.set(name, entries)
}

export function registerForAnchor(
  name: string,
  inst: object,
  anchor: Comment,
  endSentinel: Comment,
): void {
  const entries = hmrRegistry.get(name) ?? []
  entries.push({ kind: 'anchor', inst: inst as ComponentInstance, anchor, endSentinel })
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
export function replaceComponent<S, M, E, D = void>(
  name: string,
  newDef: ComponentDef<S, M, E, D>,
): AppHandle | null {
  const entries = hmrRegistry.get(name)
  if (!entries || entries.length === 0) return null

  let handle: AppHandle | null = null

  for (const entry of entries) {
    const typedInst = entry.inst as ComponentInstance<S, M, E>

    typedInst.def = {
      ...typedInst.def,
      update: newDef.update,
      view: newDef.view,
      onEffect: newDef.onEffect,
      __dirty: newDef.__dirty,
      __update: newDef.__update,
      __handlers: newDef.__handlers,
    }

    disposeLifetime(typedInst.rootLifetime)

    // Clear the owned region per-kind.
    if (entry.kind === 'container') {
      entry.container.textContent = ''
    } else {
      // anchor kind — wipe siblings between anchor and endSentinel, keep the
      // anchor AND the end sentinel (they bracket the fresh render).
      let sib = entry.anchor.nextSibling
      while (sib !== null && sib !== entry.endSentinel) {
        const next = sib.nextSibling
        sib.parentNode!.removeChild(sib)
        sib = next
      }
    }

    typedInst.rootLifetime = createLifetime(null)
    typedInst.rootLifetime._kind = 'root'
    typedInst.allBindings = []
    typedInst.structuralBlocks = []

    setFlatBindings(typedInst.allBindings)
    setRenderContext({
      rootLifetime: typedInst.rootLifetime,
      state: typedInst.state,
      allBindings: typedInst.allBindings,
      structuralBlocks: typedInst.structuralBlocks,
      dom: typedInst.dom,
      container:
        entry.kind === 'container' ? entry.container : (entry.anchor.parentElement ?? undefined),
      send: typedInst.send as (msg: unknown) => void,
      instance: typedInst as ComponentInstance,
    })
    const nodes = typedInst.def.view(createView<S, M>(typedInst.send))
    clearRenderContext()
    setFlatBindings(null)

    if (entry.kind === 'container') {
      for (const node of nodes) {
        entry.container.appendChild(node)
      }
    } else {
      for (const node of nodes) {
        entry.anchor.parentNode!.insertBefore(node, entry.endSentinel)
      }
    }

    if (!handle) {
      handle = makeReplacementHandle(name, entry, typedInst)
    }
  }

  console.log(`[LLui HMR] ${name} updated — state preserved`)

  return handle
}

function makeReplacementHandle<S, M, E>(
  name: string,
  entry: HmrEntry,
  typedInst: ComponentInstance<S, M, E>,
): AppHandle {
  const listeners = new Set<(s: unknown) => void>()
  typedInst._onCommit = (state: unknown) => {
    for (const l of Array.from(listeners)) {
      try {
        l(state)
      } catch (err) {
        console.error('[llui] listener threw:', err)
      }
    }
  }
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      typedInst._onCommit = undefined
      unregisterForHmr(name, entry.inst)
      entry.inst.abortController.abort()
      unregisterInstance(entry.inst)
      disposeLifetime(typedInst.rootLifetime)
      if (entry.kind === 'container') {
        entry.container.textContent = ''
      } else {
        let sib = entry.anchor.nextSibling
        while (sib !== null && sib !== entry.endSentinel) {
          const next = sib.nextSibling
          sib.parentNode!.removeChild(sib)
          sib = next
        }
        entry.endSentinel.parentNode?.removeChild(entry.endSentinel)
      }
    },
    flush() {
      flushInstance(entry.inst)
    },
    send(msg: unknown) {
      ;(typedInst.send as (m: unknown) => void)(msg)
    },
    getState() {
      return typedInst.state
    },
    subscribe(listener: (state: unknown) => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
