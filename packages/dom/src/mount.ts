import type { ComponentDef, AppHandle } from './types'
import { createComponentInstance, flushInstance } from './update-loop'
import { disposeScope } from './scope'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'
import { registerInstance, unregisterInstance } from './runtime'
import { createView } from './view-helpers'

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

// ── DevTools auto-install (dev only) ────────────────────────────
// Set by enableDevTools() from '@llui/dom/devtools' — never imported in production.

let devToolsInstall: ((inst: object) => void) | null = null

/** @internal Called by enableDevTools in the devtools module */
export function _setDevToolsInstall(fn: ((inst: object) => void) | null): void {
  devToolsInstall = fn
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

  // Dev-only: auto-install devtools if enabled via '@llui/dom/devtools' import
  if (devToolsInstall) devToolsInstall(inst)

  // Dev-only: warn if initial state contains non-serializable values.
  // Silent bug-bomb: Date/Map/Set/class instances break SSR, hydration, replay tools.
  if (import.meta.env?.DEV) {
    const offender = findNonSerializable(inst.state)
    if (offender) {
      console.warn(
        `[LLui] <${def.name}> initial state contains a non-serializable value at "${offender.path}":`,
        offender.value,
        '\nState must be plain JSON (no Date/Map/Set/class instances/functions).' +
          '\nThis will break SSR hydration, state replay, and devtools snapshots.' +
          '\nhint: Convert to a serializable representation (e.g., Date → ISO string, Map → Record).',
      )
    }
  }

  // Run view() within a render context so primitives can register bindings
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)

  // Batch-insert via DocumentFragment — one layout-invalidating operation
  // instead of N individual appendChild calls on a live container element.
  if (nodes.length > 1) {
    const frag = document.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    container.appendChild(frag)
  } else if (nodes.length === 1) {
    container.appendChild(nodes[0]!)
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

// Walks an object graph looking for non-JSON-serializable values. Returns the
// first offender found (depth-first), or null if everything is fine. Stops at
// depth 6 to bound runtime cost for large states.
function findNonSerializable(
  v: unknown,
  path = 'state',
  depth = 0,
  seen = new WeakSet<object>(),
): { path: string; value: unknown } | null {
  if (depth > 6) return null
  if (v === null || v === undefined) return null
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return null
  if (t === 'function') return { path, value: v }
  if (t === 'symbol' || t === 'bigint') return { path, value: v }
  if (t !== 'object') return null
  const obj = v as object
  if (seen.has(obj)) return null
  seen.add(obj)
  if (obj instanceof Date) return { path: `${path} (Date)`, value: v }
  if (obj instanceof Map) return { path: `${path} (Map)`, value: v }
  if (obj instanceof Set) return { path: `${path} (Set)`, value: v }
  if (obj instanceof RegExp) return { path: `${path} (RegExp)`, value: v }
  if (obj instanceof Promise) return { path: `${path} (Promise)`, value: v }
  // Plain objects/arrays have Object.prototype / Array.prototype. Class instances
  // have a different prototype.
  const proto = Object.getPrototypeOf(obj)
  if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
    return { path: `${path} (${proto?.constructor?.name ?? 'class instance'})`, value: v }
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findNonSerializable(v[i], `${path}[${i}]`, depth + 1, seen)
      if (r) return r
    }
    return null
  }
  for (const k of Object.keys(obj)) {
    const r = findNonSerializable(
      (obj as Record<string, unknown>)[k],
      `${path}.${k}`,
      depth + 1,
      seen,
    )
    if (r) return r
  }
  return null
}

function dispatchInitialEffects<S, M, E>(
  inst: ReturnType<typeof createComponentInstance<S, M, E>>,
): void {
  if (inst.initialEffects.length === 0 || !inst.def.onEffect) return
  for (const effect of inst.initialEffects) {
    inst.def.onEffect({ effect, send: inst.send, signal: inst.signal })
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
  const nodes = hydrateDef.view(createView<S, M>(inst.send))
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
