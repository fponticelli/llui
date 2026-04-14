import type { ComponentDef, AppHandle } from './types.js'
import { createComponentInstance, flushInstance } from './update-loop.js'
import { disposeScope } from './scope.js'
import { setRenderContext, clearRenderContext } from './render-context.js'
import { setFlatBindings } from './binding.js'
import { registerInstance, unregisterInstance } from './runtime.js'
import { createView } from './view-helpers.js'
import { pushMountQueue, popMountQueue, flushMountQueue } from './primitives/on-mount.js'

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

  // Run view() within a render context so primitives can register bindings.
  // Also collect onMount callbacks in a queue we'll flush synchronously
  // after node insertion — prevents the race where a user event fires
  // between mount and the queueMicrotask callback running.
  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Batch-insert via DocumentFragment — one layout-invalidating operation
  // instead of N individual appendChild calls on a live container element.
  if (nodes.length > 1) {
    const frag = document.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    container.appendChild(frag)
  } else if (nodes.length === 1) {
    container.appendChild(nodes[0]!)
  }

  // Flush onMount callbacks SYNCHRONOUSLY now that the DOM is in place.
  // Any listeners they attach are ready before this function returns,
  // so a synchronous dispatchEvent in the caller's next line fires
  // against a fully-wired tree.
  flushMountQueue(onMountQueue)

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
  // Run the original init once to capture its effects. The state it
  // returns is discarded — we use `serverState` (what the server
  // rendered with) instead. The effects are preserved and dispatched
  // after the DOM is in place, so components that rely on "load data
  // or wire subscriptions on mount" behave consistently between fresh
  // mount and SSR+hydrate. If the original init has already-loaded
  // data for the hydration case, gate the effect emission inside init
  // itself (e.g. based on a `loaded` flag in state).
  const [, originalEffects] = (def.init as (data: unknown) => [S, E[]])(undefined)

  const hydrateDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [serverState, originalEffects],
  }

  const inst = createComponentInstance(hydrateDef)

  // Build the component DOM and swap atomically with server HTML.
  // Server HTML remains visible until JS finishes — no flash.
  // onMount callbacks are collected in a queue and flushed synchronously
  // after the swap, matching mountApp's ordering.
  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, container, send: inst.send as (msg: unknown) => void })
  const nodes = hydrateDef.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Atomic swap — replaces server HTML with client DOM in one operation
  container.replaceChildren(...nodes)

  // Flush onMount callbacks synchronously now that the DOM is in place.
  flushMountQueue(onMountQueue)

  // Fire the original init's effects post-swap, matching mountApp's
  // lifecycle. Previously these were silently dropped.
  dispatchInitialEffects(inst)

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
