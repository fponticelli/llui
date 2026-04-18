import type { ComponentDef, Lifetime, Binding } from './types.js'
import type { StructuralBlock } from './structural.js'
import type { RingBuffer, EachDiff } from './tracking/each-diff.js'
import type { DisposerEvent } from './tracking/disposer-log.js'
import type { CoverageTracker } from './tracking/coverage.js'
import type {
  EffectTimelineEntry,
  PendingEffectsList,
  MockRegistry,
} from './tracking/effect-timeline.js'
import { createLifetime } from './lifetime.js'
import { applyBinding } from './binding.js'
import { setCurrentDirtyMask } from './primitives/memo.js'

export const FULL_MASK = 0xffffffff | 0

// Addressed effect dispatcher — set by addressed.ts when imported
let addressedDispatcher: ((eff: { __targetKey: string | number; __msg: unknown }) => void) | null =
  null

export function setAddressedDispatcher(
  fn: (eff: { __targetKey: string | number; __msg: unknown }) => void,
): void {
  addressedDispatcher = fn
}

export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  def: ComponentDef<S, M, E>
  state: S
  initialEffects: E[]
  rootLifetime: Lifetime
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  queue: M[]
  microtaskScheduled: boolean
  lastDirtyMask: number
  lastEffects: E[]
  send: (msg: M) => void
  signal: AbortSignal
  abortController: AbortController
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  per-each-site reconciliation diffs for MCP introspection tools. */
  _eachDiffLog?: RingBuffer<EachDiff>
  /** @internal dev-only — monotonically incremented by the devtools-intercepted
   *  `update` before each history push. Read by `each.ts` to stamp diffs with
   *  the `updateIndex` of the message that caused the reconciliation. */
  _updateCounter?: number
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  log of `disposeLifetime` firings (scope id + cause). Consumed by the
   *  `llui_disposer_log` MCP tool to diagnose leaks on structural transitions. */
  _disposerLog?: RingBuffer<DisposerEvent>
  /** @internal dev-only — populated when `installDevTools` ran. Per-variant
   *  Msg counter keyed by discriminant. Consumed by the `llui_coverage` MCP
   *  tool to surface Msg variants that have never fired this session. */
  _coverage?: CoverageTracker
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  effect dispatch phase log (dispatched → resolved/cancelled) for USER
   *  effects emitted from `update()`. Consumed by the `llui_effect_timeline`
   *  MCP tool. Built-in plumbing effects (`delay`, `log`, addressed) are NOT
   *  recorded here by design — they short-circuit in `dispatchEffect` before
   *  `dispatchEffectDev` runs. They're runtime plumbing, not user intent,
   *  and surface via other channels (message queue for `delay`, browser
   *  console for `log`, addressed-target routing for addressed effects). */
  _effectTimeline?: RingBuffer<EffectTimelineEntry>
  /** @internal dev-only — populated when `installDevTools` ran. List of
   *  currently-pending effects addressable by id, consumed by the
   *  `llui_pending_effects` MCP tool. */
  _pendingEffects?: PendingEffectsList
  /** @internal dev-only — populated when `installDevTools` ran. Mock
   *  registry consulted by the effect-dispatch wrapper to short-circuit
   *  matching effects. Consumed by the `llui_mock_effect` MCP tool. */
  _effectMocks?: MockRegistry
}

export function createComponentInstance<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  data?: D,
  parentLifetime: Lifetime | null = null,
): ComponentInstance<S, M, E> {
  const [initialState, initialEffects] = def.init(data as D)

  const controller = new AbortController()

  const inst: ComponentInstance<S, M, E> = {
    // `def` carries an arbitrary `D` for typed init data, but after init
    // has run the runtime never touches `def.init` again — update/view/
    // onEffect and HMR replacement don't depend on D. Cast to the
    // D=void instance storage shape here.
    def: def as ComponentDef<S, M, E>,
    state: initialState,
    initialEffects,
    // When `parentLifetime` is provided the instance's rootLifetime becomes a
    // child of that scope. This is how persistent layouts wire pages
    // into the layout's scope tree: the page's rootLifetime is parented at
    // the layout's pageSlot() point so `useContext` lookups flow layout
    // → page, and scope disposal cascades correctly. Mount paths that
    // don't pass parentLifetime get the classic detached root.
    rootLifetime: createLifetime(parentLifetime),
    allBindings: [],
    structuralBlocks: [],
    queue: [],
    microtaskScheduled: false,
    lastDirtyMask: 0,
    lastEffects: [],
    signal: controller.signal,
    abortController: controller,

    send(msg: M) {
      inst.queue.push(msg)
      if (!inst.microtaskScheduled) {
        inst.microtaskScheduled = true
        queueMicrotask(() => {
          inst.microtaskScheduled = false
          processMessages(inst)
        })
      }
    },
  }

  inst.rootLifetime._kind = 'root'

  return inst
}

export function flushInstance<S, M, E>(inst: ComponentInstance<S, M, E>): void {
  if (inst.queue.length === 0) return
  inst.microtaskScheduled = false
  processMessages(inst)
}

/**
 * Dev-only: overwrite instance state and re-run both phases with FULL_MASK
 * so every binding re-evaluates. Bypasses update() — use for devtools
 * snapshot/restore, not in app code.
 */
export function _forceState<S, M, E>(inst: ComponentInstance<S, M, E>, newState: S): void {
  inst.state = newState
  inst.lastDirtyMask = FULL_MASK

  const bindings = inst.allBindings
  const bindingsBeforePhase1 = bindings.length

  setCurrentDirtyMask(FULL_MASK)

  const snapshot = inst.structuralBlocks.slice()
  for (const block of snapshot) {
    block.reconcile(newState, FULL_MASK)
  }

  let phase2Len = bindingsBeforePhase1
  if (bindings.length > bindingsBeforePhase1 || (phase2Len > 0 && bindings[0]!.dead)) {
    let w = 0
    for (let r = 0; r < bindings.length; r++) {
      if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
    }
    bindings.length = w
    phase2Len = Math.min(w, bindingsBeforePhase1)
  }

  const state = inst.state
  for (let i = 0, len = phase2Len; i < len; i++) {
    const binding = bindings[i]!
    if (binding.dead) continue
    if (binding.kind === 'effect') {
      binding.accessor(state)
      continue
    }
    const newValue = binding.accessor(state)
    if (Object.is(newValue, binding.lastValue)) continue
    binding.lastValue = newValue
    applyBinding(binding, newValue)
  }
}

function processMessages<S, M, E>(inst: ComponentInstance<S, M, E>): void {
  const queue = inst.queue

  // Single-message fast path: dispatch directly to per-message-type handler
  // if available. Skips dirty computation, Phase 1/2 entirely.
  if (queue.length === 1 && inst.def.__handlers) {
    const msg = queue[0]!
    const handler = inst.def.__handlers[(msg as Record<string, unknown>).type as string] as
      | ((inst: ComponentInstance, msg: unknown) => [S, E[]])
      | undefined
    if (handler) {
      queue.length = 0
      const [newState, effects] = handler(inst as ComponentInstance, msg)
      inst.state = newState
      if (import.meta.env?.DEV) {
        inst.lastDirtyMask = FULL_MASK
        inst.lastEffects = effects
      }
      for (let i = 0; i < effects.length; i++) {
        dispatchEffect(inst, effects[i]!)
      }
      return
    }
  }

  // Generic pipeline — drain queue, accumulate dirty bits
  let state = inst.state
  let combinedDirty = 0
  const allEffects: E[] = []

  const defUpdate = inst.def.update
  const dirtyFn = inst.def.__dirty
  for (let qi = 0; qi < queue.length; qi++) {
    const msg = queue[qi]!
    const [newState, effects] = defUpdate(state, msg)
    const dirty = dirtyFn ? dirtyFn(state, newState) : FULL_MASK
    if (typeof dirty === 'number') {
      combinedDirty |= dirty
    } else {
      combinedDirty |= dirty[0] | dirty[1]
    }
    state = newState
    // Avoid spread — allocates an iterator per call. For typical effect
    // arrays (0-2 elements) this is a minor saving; for bursts it matters.
    for (let ei = 0; ei < effects.length; ei++) allEffects.push(effects[ei]!)
  }
  queue.length = 0

  inst.state = state
  // Dev-only bookkeeping — tests read lastDirtyMask/lastEffects, prod
  // doesn't. Gating here keeps two writes out of the prod hot path.
  if (import.meta.env?.DEV) {
    inst.lastDirtyMask = combinedDirty
    inst.lastEffects = allEffects
  }

  // Snapshot binding count before Phase 1 — bindings added during
  // Phase 1 already have correct initial values and skip Phase 2.
  const bindings = inst.allBindings
  const bindingsBeforePhase1 = bindings.length

  // Set current dirty mask BEFORE Phase 1 so memo() accessors used in
  // structural primitives (e.g. each.items) can use the bitmask fast path.
  setCurrentDirtyMask(combinedDirty)

  if (inst.def.__update) {
    // Compiler-generated fast path — replaces generic Phase 1 + Phase 2
    inst.def.__update(state, combinedDirty, bindings, inst.structuralBlocks, bindingsBeforePhase1)
  } else {
    // Generic Phase 1 + Phase 2 fallback (uncompiled components)
    genericUpdate(inst, state, combinedDirty, bindings, bindingsBeforePhase1)
  }

  // Dispatch effects after DOM updates
  for (let i = 0; i < allEffects.length; i++) {
    dispatchEffect(inst, allEffects[i]!)
  }
}

function genericUpdate<S, M, E>(
  inst: ComponentInstance<S, M, E>,
  state: S,
  combinedDirty: number,
  bindings: Binding[],
  bindingsBeforePhase1: number,
): void {
  // Phase 1 — structural reconciliation. Structural primitives register
  // their blocks BEFORE running builders, so parents precede their nested
  // children in this array. That ordering matters: a parent's reconcile
  // may dispose the old arm, whose disposers splice nested child blocks
  // out of this shared array. Because children are always to the right
  // of their parent, the splice shifts entries left — which is safe for
  // a forward iterator that re-reads length each step.
  const blocks = inst.structuralBlocks
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]
    if (!block || (block.mask & combinedDirty) === 0) continue
    block.reconcile(state, combinedDirty)
  }

  // Phase 2 — compact + update bindings
  _runPhase2(state, combinedDirty, bindings, bindingsBeforePhase1, inst.def.name)
}

/**
 * Run a handler for a single message: call update(), reconcile blocks
 * with the given method, run Phase 2. Used by compiler-generated __handlers
 * to avoid duplicating boilerplate per message type.
 *
 * @param method 0=reconcile, 1=reconcileItems, 2=reconcileClear, 3=reconcileRemove, -1=skip blocks
 * @public — used by compiler-generated `__handlers`
 */
export function _handleMsg(
  inst: ComponentInstance,
  msg: unknown,
  dirty: number,
  method: number,
): [unknown, unknown[]] {
  const [s, e] = (inst.def.update as (s: unknown, m: unknown) => [unknown, unknown[]])(
    inst.state,
    msg,
  )
  inst.state = s

  if (method >= 0) {
    const bl = inst.structuralBlocks
    for (let i = 0; i < bl.length; i++) {
      const block = bl[i]
      if (!block || !(block.mask & dirty)) continue
      switch (method) {
        case 0:
          block.reconcile(s, dirty)
          break
        case 1:
          block.reconcileItems?.(s)
          break
        case 2:
          block.reconcileClear?.()
          break
        case 3:
          block.reconcileRemove?.(s)
          break
        default:
          // method >= 10: reconcileChanged with stride = method - 10
          if (method >= 10) block.reconcileChanged?.(s, method - 10)
          break
      }
    }
  }

  const b = inst.allBindings
  _runPhase2(s, dirty, b, b.length)
  return [s, e]
}

/**
 * Phase 2: compact dead bindings + update live bindings.
 * Shared between genericUpdate and compiler-generated __update.
 * @public — used by compiler-generated `__update` functions
 */
export function _runPhase2(
  state: unknown,
  dirty: number,
  bindings: Binding[],
  bindingsBeforePhase1: number,
  componentName?: string,
): void {
  let phase2Len = bindingsBeforePhase1
  if (bindings.length > bindingsBeforePhase1 || (phase2Len > 0 && bindings[0]!.dead)) {
    let w = 0
    for (let r = 0; r < bindings.length; r++) {
      if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
    }
    bindings.length = w
    phase2Len = Math.min(w, bindingsBeforePhase1)
  }

  if (dirty !== 0) {
    if (import.meta.env?.DEV && componentName) {
      for (let i = 0, len = phase2Len; i < len; i++) {
        const binding = bindings[i]!
        if (binding.dead || (binding.mask & dirty) === 0) continue
        if (binding.kind === 'effect') {
          // Side-effect-only: run accessor, discard return, skip the
          // Object.is diff and `applyBinding` entirely. Used by child()'s
          // prop-watch binding so fresh-object props accessors don't
          // stringify onto a detached anchor every update.
          try {
            binding.accessor(state)
          } catch (e) {
            throw enhanceBindingError(e, binding, componentName)
          }
          continue
        }
        let newValue: unknown
        try {
          newValue = binding.accessor(state)
        } catch (e) {
          throw enhanceBindingError(e, binding, componentName)
        }
        const last = binding.lastValue
        if (newValue === last || (newValue !== newValue && last !== last)) continue
        binding.lastValue = newValue
        applyBinding(binding, newValue)
      }
    } else {
      for (let i = 0, len = phase2Len; i < len; i++) {
        const binding = bindings[i]!
        if (binding.dead || (binding.mask & dirty) === 0) continue
        if (binding.kind === 'effect') {
          binding.accessor(state)
          continue
        }
        const newValue = binding.accessor(state)
        const last = binding.lastValue
        if (newValue === last || (newValue !== newValue && last !== last)) continue
        binding.lastValue = newValue
        applyBinding(binding, newValue)
      }
    }
  }
}

function enhanceBindingError(err: unknown, binding: Binding, componentName: string): Error {
  // For text bindings, binding.node is the Text node — use its parent element.
  const node = binding.node
  const target = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null)
  let nodeDesc = '?'
  if (target) {
    const id = target.id ? `#${target.id}` : ''
    const cls =
      target.className && typeof target.className === 'string'
        ? `.${target.className.split(' ').filter(Boolean).slice(0, 2).join('.')}`
        : ''
    nodeDesc = `<${target.tagName.toLowerCase()}${id}${cls}>`
    if (node.nodeType === 3) nodeDesc += ' text-child'
    else if (node.nodeType === 8) nodeDesc += ' comment-child'
  }
  const keyPart = binding.key ? ` .${binding.key}` : ''
  const errMsg = err instanceof Error ? err.message : String(err)

  // Build accessor source hint if available
  let accessorHint = ''
  try {
    const src = binding.accessor.toString().slice(0, 80)
    accessorHint = `\n  accessor: ${src}${binding.accessor.toString().length > 80 ? '...' : ''}`
  } catch {
    // toString() may throw on revoked proxies, etc.
  }

  // Detect common undefined/null access pattern and add a helpful hint
  let undefinedHint = ''
  if (err instanceof TypeError && /Cannot read propert(ies|y).*of (undefined|null)/.test(errMsg)) {
    undefinedHint =
      '\n  hint: Check that your accessor handles undefined state fields (e.g., use optional chaining: s.user?.name)'
  }

  const wrapped = new Error(
    `[LLui] ${binding.kind}${keyPart} binding on ${nodeDesc} — accessor threw in <${componentName}>\n` +
      `  ↳ ${errMsg}` +
      undefinedHint +
      accessorHint,
    err instanceof Error ? { cause: err } : undefined,
  )
  wrapped.stack = (err instanceof Error && err.stack) || wrapped.stack
  return wrapped
}

function dispatchEffect<S, M, E>(inst: ComponentInstance<S, M, E>, effect: E): void {
  const eff = effect as Record<string, unknown>

  // Addressed effects — dispatch to target component
  if (eff.__addressed === true && typeof eff.__targetKey !== 'undefined') {
    addressedDispatcher?.(eff as { __targetKey: string | number; __msg: unknown })
    return
  }

  // Built-in: delay
  if (eff.type === 'delay') {
    const ms = eff.ms as number
    const onDone = eff.onDone as M
    setTimeout(() => inst.send(onDone), ms)
    return
  }

  // Built-in: log
  if (eff.type === 'log') {
    console.log(eff.message)
    return
  }

  // Dev-only: record on the timeline / consult the mock registry.
  // Short-circuits real dispatch when a mock matches. Zero cost in
  // production — the guard on `_effectTimeline` is undefined unless
  // `installDevTools` populated the trackers.
  if (inst._effectTimeline !== undefined && dispatchEffectDev(inst, effect)) return

  // User onEffect handler
  if (inst.def.onEffect) {
    inst.def.onEffect({ effect, send: inst.send, signal: inst.signal })
  }
}

/**
 * Dev-only effect dispatch wrapper. Records the `dispatched` phase and,
 * when a mock matches, auto-delivers the mocked response through the
 * effect's own `onSuccess` callback on a microtask (same timing contract
 * as a real async resolve). Non-matched effects are tracked as pending
 * so `llui_pending_effects` / `llui_resolve_effect` can observe them.
 *
 * @returns `true` when a mock matched (caller should skip the real
 *   dispatch) or `false` to proceed with the user-provided onEffect.
 */
function dispatchEffectDev<S, M, E>(inst: ComponentInstance<S, M, E>, effect: E): boolean {
  const timeline = inst._effectTimeline
  if (timeline === undefined) return false

  const eff = effect as Record<string, unknown>
  const id = newEffectId()
  const type = typeof eff.type === 'string' ? eff.type : '<unknown>'
  const dispatchedAt = Date.now()

  const mock = inst._effectMocks?.match(effect)
  if (mock) {
    timeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
    // Auto-deliver the mocked response via the effect's onSuccess callback (if any).
    // This mirrors what the real dispatch would do, so the component receives a Msg
    // from the mocked effect without any network/IO happening.
    const payload = effect as Record<string, unknown>
    if (typeof payload.onSuccess === 'function') {
      const msg = (payload.onSuccess as (d: unknown) => unknown)(mock.response)
      // Schedule delivery as a microtask so it runs after the current update
      // cycle completes (same timing contract as a real async effect resolve).
      Promise.resolve().then(() => inst.send(msg as never))
    }
    timeline.push({
      effectId: id,
      type,
      phase: 'resolved-mocked',
      timestamp: dispatchedAt,
      durationMs: 0,
    })
    return true
  }

  timeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
  inst._pendingEffects?.push({ id, type, dispatchedAt, status: 'queued', payload: effect })
  return false
}

function newEffectId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `eff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
