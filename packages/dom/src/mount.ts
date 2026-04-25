import type { ComponentDef, AppHandle, Lifetime } from './types.js'
import { type DomEnv, browserEnv } from './dom-env.js'
import { createComponentInstance, flushInstance, type ComponentInstance } from './update-loop.js'
import { disposeLifetime } from './lifetime.js'
import { setRenderContext, clearRenderContext } from './render-context.js'
import { setFlatBindings } from './binding.js'
import { registerInstance, unregisterInstance } from './runtime.js'
import { createView } from './view-helpers.js'
import { pushMountQueue, popMountQueue, flushMountQueue } from './primitives/on-mount.js'

// ── Sentinel-region helpers (used by anchor-based mount primitives) ─────

/**
 * Remove every sibling from `anchor.nextSibling` up to but not including
 * `stopBefore`. Used by anchor-based mount primitives and their HMR
 * swap path to clear the owned DOM region between the pair.
 */
function _removeBetween(anchor: Comment, stopBefore: Comment): void {
  const parent = anchor.parentNode
  if (parent === null) return
  while (anchor.nextSibling !== null && anchor.nextSibling !== stopBefore) {
    parent.removeChild(anchor.nextSibling)
  }
}

/**
 * Walk forward from `anchor.nextSibling` looking for an existing
 * `<!-- llui-mount-end -->` sentinel. Used by mount/hydrate at anchor
 * to reuse a server-emitted (or stale) sentinel rather than synthesizing
 * a duplicate. Returns null if no matching comment is found before the
 * end of the parent's children.
 */
function _findEndSentinel(anchor: Comment): Comment | null {
  let node: Node | null = anchor.nextSibling
  while (node !== null) {
    if (node.nodeType === 8 && (node as Comment).nodeValue === 'llui-mount-end') {
      return node as Comment
    }
    node = node.nextSibling
  }
  return null
}

// Vite injects import.meta.env.DEV — declare the shape for TypeScript
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean }
  }
}

// ── HMR (dev only) ──────────────────────────────────────────────
// Set by enableHmr() from '@llui/dom/hmr' — never imported in production.

let hmrModule: typeof import('./hmr') | null = null

/**
 * @internal Called by enableHmr in the hmr module. Tests use this
 * (paired with `_getHmrModule`) to snapshot/restore prior state across
 * suite boundaries — pass `null` to clear.
 */
export function _setHmrModule(m: typeof import('./hmr') | null): void {
  hmrModule = m
}

/** @internal Read the currently-installed HMR module (or null). */
export function _getHmrModule(): typeof import('./hmr') | null {
  return hmrModule
}

// ── DevTools auto-install (dev only) ────────────────────────────
// Set by enableDevTools() from '@llui/dom/devtools' — never imported in production.

let devToolsInstall: ((inst: object) => void) | null = null

/** @internal Called by enableDevTools in the devtools module */
export function _setDevToolsInstall(fn: ((inst: object) => void) | null): void {
  devToolsInstall = fn
}

/** @internal Read the currently-installed devtools-install hook (or null). */
export function _getDevToolsInstall(): ((inst: object) => void) | null {
  return devToolsInstall
}

export interface MountOptions {
  devTools?: boolean
  /**
   * Parent scope for the mounted component's rootLifetime. When provided,
   * the rootLifetime is created as a child of this scope — context lookups
   * from within the component walk up through the parent's scope tree,
   * and disposing the parent scope cascades into this instance's scope.
   * Used by `@llui/vike`'s persistent-layout machinery to mount a page
   * as a true scope-tree child of its enclosing layout, so layout-
   * provided contexts flow naturally into pages via `useContext`.
   *
   * When omitted (the default), the rootLifetime is detached — same as
   * every `mountApp` call before persistent layouts existed.
   */
  parentLifetime?: Lifetime
  /**
   * DOM env override. Defaults to `browserEnv()` — wraps the browser
   * globals. Specify only when mounting into a non-browser DOM (e.g.
   * a jsdom instance held by a test harness, or isolated DOM per
   * shadow root).
   */
  env?: DomEnv
  /**
   * **`hydrateApp` / `hydrateAtAnchor` only.** When `true`, fire the
   * effects that `init()` returned during hydration the same way
   * `mountApp` does on a fresh mount. Defaults to `false` because the
   * SSR render already ran `init()` on the server, and re-running its
   * effects on the client typically produces duplicate work — an
   * `httpGet` issued from `init()` would fetch on the server *and* on
   * hydration; a subscription would attach twice; etc.
   *
   * Opt in only when:
   *   - `init()` returns no effects, OR
   *   - all returned effects are idempotent / client-only (e.g.
   *     wiring a `window` event listener, opening a `WebSocket`), AND
   *   - the SSR path didn't run them (typically when `init()` checks a
   *     `loaded` flag in state and returns `[]` on the server).
   *
   * Pre-0.0.31 behavior was to always run init effects on hydrate;
   * the option preserves it on demand for projects that depended on
   * it. The default-off direction matches the safer expectation that
   * "hydration should be cheap and side-effect-free."
   */
  runInitEffectsOnHydrate?: boolean
}

export function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: undefined,
  options?: MountOptions,
): AppHandle
export function mountApp<S, M, E, D>(
  container: HTMLElement,
  def: ComponentDef<S, M, E, D>,
  data: D,
  options?: MountOptions,
): AppHandle
export function mountApp<S, M, E, D>(
  container: HTMLElement,
  def: ComponentDef<S, M, E, D>,
  data?: D,
  options?: MountOptions,
): AppHandle {
  // HMR: if this component is already mounted (module re-execution
  // during hot update), swap the definition instead of creating a new instance.
  // HMR swap bypasses parentLifetime — HMR re-mounts the outermost app handle,
  // which in a layout setup means the layout re-mounts at the root and the
  // rest of the chain is re-established via the normal mount path.
  if (hmrModule && def.name && !options?.parentLifetime) {
    const swapped = hmrModule.replaceComponent(def.name, def)
    if (swapped) return swapped
  }

  const inst = createComponentInstance(def, data, options?.parentLifetime ?? null, options?.env)

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
  setRenderContext({
    ...inst,
    container,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Batch-insert via DocumentFragment — one layout-invalidating operation
  // instead of N individual appendChild calls on a live container element.
  if (nodes.length > 1) {
    const frag = inst.dom.createDocumentFragment()
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
  return buildAppHandle(inst, def.name ?? null, () => {
    container.textContent = ''
  })
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

/**
 * Mount a component relative to a comment anchor rather than inside a
 * container element. Inserts a synthesized end sentinel (`<!-- llui-mount-end -->`)
 * immediately after the anchor and places the component's nodes between
 * the pair. The anchor must already be attached to a live DOM tree.
 *
 * Unlike `mountApp`, the caller's anchor node is preserved across the
 * handle's lifetime — only the content between the pair (and the end
 * sentinel itself) is disposed. Used by `@llui/vike` persistent layouts
 * to mount chain layers without a wrapper element.
 *
 * If a pre-existing `<!-- llui-mount-end -->` is found after the anchor
 * (e.g. stale from an undisposed prior mount), the content between the
 * anchor and that sentinel is swept and the sentinel is reused. Dev mode
 * warns in that case.
 */
export function mountAtAnchor<S, M, E>(
  anchor: Comment,
  def: ComponentDef<S, M, E>,
  data?: undefined,
  options?: MountOptions,
): AppHandle
export function mountAtAnchor<S, M, E, D>(
  anchor: Comment,
  def: ComponentDef<S, M, E, D>,
  data: D,
  options?: MountOptions,
): AppHandle
export function mountAtAnchor<S, M, E, D>(
  anchor: Comment,
  def: ComponentDef<S, M, E, D>,
  data?: D,
  options?: MountOptions,
): AppHandle {
  if (anchor.parentNode === null) {
    throw new Error(
      `[LLui] mountAtAnchor: anchor comment must be attached to a live DOM tree before mount`,
    )
  }

  // Locate or synthesize the end sentinel.
  const existingEnd = _findEndSentinel(anchor)
  let endSentinel: Comment
  if (existingEnd !== null) {
    if (import.meta.env?.DEV) {
      console.warn(
        `[LLui] mountAtAnchor: anchor has a pre-existing end sentinel. ` +
          `A prior mount was not disposed — sweeping stale siblings and reusing the sentinel.`,
      )
    }
    _removeBetween(anchor, existingEnd)
    endSentinel = existingEnd
  } else {
    // Use the caller-provided env if any — end-sentinel creation happens
    // before `inst` exists, so we pick the env directly from options.
    // (browserEnv() fallback matches what createComponentInstance will
    // use below when options.env is undefined.)
    endSentinel = (options?.env ?? browserEnv()).createComment('llui-mount-end')
    anchor.parentNode.insertBefore(endSentinel, anchor.nextSibling)
  }

  const inst = createComponentInstance(def, data, options?.parentLifetime ?? null, options?.env)

  if (devToolsInstall) devToolsInstall(inst)

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

  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    container: anchor.parentElement ?? undefined,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Batch-insert via DocumentFragment — one layout pass instead of N.
  if (nodes.length > 1) {
    const frag = inst.dom.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    anchor.parentNode.insertBefore(frag, endSentinel)
  } else if (nodes.length === 1) {
    anchor.parentNode.insertBefore(nodes[0]!, endSentinel)
  }

  flushMountQueue(onMountQueue)

  registerInstance(inst)
  if (hmrModule && def.name) {
    hmrModule.registerForAnchor(def.name, inst, anchor, endSentinel)
  }
  dispatchInitialEffects(inst)
  return buildAppHandle(inst, def.name ?? null, () => {
    _removeBetween(anchor, endSentinel)
    endSentinel.parentNode?.removeChild(endSentinel)
  })
}

/**
 * Hydrate a component relative to a comment anchor rather than inside a
 * container element. Analogous to `hydrateApp` — uses `serverState` as
 * the initial state (not `init()`'s output) while preserving `init()`'s
 * effects for post-mount dispatch.
 *
 * The DOM-handling path is identical to `mountAtAnchor`: reuses a
 * pre-existing end sentinel when present, synthesizes one otherwise.
 * Atomic-swaps the owned region whether or not server content is there
 * to replace. No error for a missing end sentinel — the vike chain's
 * outer `hydrateApp`'s `replaceChildren` wipes inner layers' sentinels,
 * so inner-layer `hydrateAtAnchor` calls routinely find nothing to
 * reuse, and that's normal.
 */
export function hydrateAtAnchor<S, M, E, D = void>(
  anchor: Comment,
  def: ComponentDef<S, M, E, D>,
  serverState: S,
  options?: MountOptions,
): AppHandle {
  if (anchor.parentNode === null) {
    throw new Error(
      `[LLui] hydrateAtAnchor: anchor comment must be attached to a live DOM tree before hydrate`,
    )
  }

  const existingEnd = _findEndSentinel(anchor)
  let endSentinel: Comment
  if (existingEnd !== null) {
    _removeBetween(anchor, existingEnd)
    endSentinel = existingEnd
  } else {
    endSentinel = (options?.env ?? browserEnv()).createComment('llui-mount-end')
    anchor.parentNode.insertBefore(endSentinel, anchor.nextSibling)
  }

  // Run original init() to capture effects, then override state with server's.
  const [, originalEffects] = (def.init as (data: unknown) => [S, E[]])(undefined)
  const hydrateDef: ComponentDef<S, M, E> = {
    ...def,
    init: () => [serverState, originalEffects],
  }

  const inst = createComponentInstance(
    hydrateDef,
    undefined,
    options?.parentLifetime ?? null,
    options?.env,
  )

  if (devToolsInstall) devToolsInstall(inst)

  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    container: anchor.parentElement ?? undefined,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = hydrateDef.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  if (nodes.length > 1) {
    const frag = inst.dom.createDocumentFragment()
    for (const node of nodes) frag.appendChild(node)
    anchor.parentNode.insertBefore(frag, endSentinel)
  } else if (nodes.length === 1) {
    anchor.parentNode.insertBefore(nodes[0]!, endSentinel)
  }

  flushMountQueue(onMountQueue)

  registerInstance(inst)
  if (hmrModule && def.name) {
    hmrModule.registerForAnchor(def.name, inst, anchor, endSentinel)
  }
  // Hydration: skip init's effects by default. The SSR pass already ran
  // them on the server; re-running on the client typically produces
  // duplicate work (double fetches, double subscriptions). Opt back in
  // via `MountOptions.runInitEffectsOnHydrate: true`.
  if (options?.runInitEffectsOnHydrate) {
    dispatchInitialEffects(inst)
  } else {
    warnDroppedInitEffects(inst, 'hydrateAtAnchor')
  }
  return buildAppHandle(inst, def.name ?? null, () => {
    _removeBetween(anchor, endSentinel)
    endSentinel.parentNode?.removeChild(endSentinel)
  })
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

/**
 * Dev-only warning when a hydrate path silently drops a non-empty
 * `initialEffects` array. The default-skip behavior is deliberate (the
 * server already ran them), but if `init()` produces effects that
 * weren't run on the server — typically client-only init pipelines —
 * silent drop is a footgun. Surface the count and the opt-in.
 */
function warnDroppedInitEffects<S, M, E>(
  inst: ReturnType<typeof createComponentInstance<S, M, E>>,
  via: 'hydrateApp' | 'hydrateAtAnchor',
): void {
  if (!import.meta.env?.DEV) return
  if (inst.initialEffects.length === 0) return
  const name = inst.def.name ?? '<anonymous>'
  console.warn(
    `[LLui] ${via}: skipped ${inst.initialEffects.length} init effect(s) for "${name}". ` +
      `Hydration drops init effects by default since the server already ran them. ` +
      `If these effects only fire on the client, pass \`runInitEffectsOnHydrate: true\` to opt in.`,
  )
}

/**
 * Build the `AppHandle` returned by every mount/hydrate path. Captures
 * the `_onCommit` listener registry, the `disposed` flag, and the
 * standard `flush` / `send` / `getState` / `subscribe` shape — all
 * code that was previously duplicated four times across `mountApp`,
 * `mountAtAnchor`, `hydrateApp`, and `hydrateAtAnchor`.
 *
 * Variation lives in the two parameters:
 *   - `hmrName` — the def's name used to call `hmrModule.unregisterForHmr`
 *     on dispose. Pass `null` to skip HMR unregistration (no current
 *     mount path needs that, but it keeps the helper honest).
 *   - `domCleanup` — final teardown step that detaches mounted nodes.
 *     Container-rooted paths set `container.textContent = ''`;
 *     anchor-rooted paths call `_removeBetween(anchor, endSentinel)`
 *     and detach the end sentinel. Runs LAST in the dispose chain to
 *     match the historical ordering exactly (lifetime is disposed
 *     before nodes are detached, so binding teardown sees attached
 *     DOM until the very end).
 *
 * The mount-path-parity test in `mount-path-parity.test.ts` enforces
 * that each public entry point produces structurally identical
 * AppHandle behavior — this helper is the realisation of that
 * promise.
 */
function buildAppHandle<S, M, E>(
  inst: ReturnType<typeof createComponentInstance<S, M, E>>,
  hmrName: string | null,
  domCleanup: () => void,
): AppHandle {
  let disposed = false
  const listeners = new Set<(s: unknown) => void>()

  inst._onCommit = (state: unknown) => {
    for (const l of Array.from(listeners)) {
      try {
        l(state)
      } catch (err) {
        console.error('[llui] listener threw:', err)
      }
    }
  }

  return {
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      inst._onCommit = undefined
      if (hmrModule && hmrName) hmrModule.unregisterForHmr(hmrName, inst)
      inst.abortController.abort()
      unregisterInstance(inst)
      // Tag the root scope so the disposer log reports app-level
      // teardown distinct from in-tree component-unmount events.
      inst.rootLifetime.disposalCause = 'app-unmount'
      disposeLifetime(inst.rootLifetime)
      domCleanup()
    },
    flush() {
      if (disposed) return
      flushInstance(inst)
    },
    send(msg: unknown) {
      if (disposed) return
      ;(inst.send as (m: unknown) => void)(msg)
    },
    getState() {
      if (disposed) {
        throw new Error(
          '[LLui] AppHandle.getState() called after dispose — handle is dead. ' +
            'Detach your event listener / cancel your timer when the handle ' +
            'is disposed to avoid stale reads.',
        )
      }
      return inst.state
    },
    subscribe(listener: (state: unknown) => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function hydrateApp<S, M, E, D = void>(
  container: HTMLElement,
  def: ComponentDef<S, M, E, D>,
  serverState: S,
  options?: MountOptions,
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

  const inst = createComponentInstance(
    hydrateDef,
    undefined,
    options?.parentLifetime ?? null,
    options?.env,
  )

  // Dev-only: auto-install devtools if enabled via '@llui/dom/devtools'
  // import. The other three mount paths (mountApp / mountAtAnchor /
  // hydrateAtAnchor) all call this; without it, the hydrated layout
  // never appears in `window.__lluiComponents`, never sets
  // `window.__lluiDebug`, and is invisible to MCP / agent client /
  // devtools console — so a vike SSR app's outermost layout silently
  // drops out of every observability surface.
  if (devToolsInstall) devToolsInstall(inst)

  // Build the component DOM and swap atomically with server HTML.
  // Server HTML remains visible until JS finishes — no flash.
  // onMount callbacks are collected in a queue and flushed synchronously
  // after the swap, matching mountApp's ordering.
  const { queue: onMountQueue, prev: prevMountQueue } = pushMountQueue()
  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    container,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = hydrateDef.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)
  popMountQueue(prevMountQueue)

  // Atomic swap — replaces server HTML with client DOM in one operation
  container.replaceChildren(...nodes)

  // Flush onMount callbacks synchronously now that the DOM is in place.
  flushMountQueue(onMountQueue)

  // Hydration: skip init's effects by default. The SSR pass already ran
  // them on the server; re-running on the client typically produces
  // duplicate work (double fetches, double subscriptions). Opt back in
  // via `MountOptions.runInitEffectsOnHydrate: true` for projects that
  // need the post-swap dispatch (typically when `init()` is gated by
  // a `loaded` flag and returns `[]` on the server).
  if (options?.runInitEffectsOnHydrate) {
    dispatchInitialEffects(inst)
  } else {
    warnDroppedInitEffects(inst, 'hydrateApp')
  }

  registerInstance(inst)
  // HMR registration — same as mountApp / mountAtAnchor /
  // hydrateAtAnchor. Without it, replaceComponent(name, newDef)
  // silently no-ops on the hydrated layout layer because the HMR
  // registry has no entry for it.
  if (hmrModule && hydrateDef.name) {
    hmrModule.registerForHmr(hydrateDef.name, inst, container)
  }
  return buildAppHandle(inst, hydrateDef.name ?? null, () => {
    container.textContent = ''
  })
}
