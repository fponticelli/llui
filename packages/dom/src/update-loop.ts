import type { ComponentDef, Scope, Binding } from './types'
import type { StructuralBlock } from './structural'
import { createScope } from './scope'
import { applyBinding } from './binding'
import { setCurrentDirtyMask } from './primitives/memo'

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
  rootScope: Scope
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  queue: M[]
  microtaskScheduled: boolean
  lastDirtyMask: number
  lastEffects: E[]
  send: (msg: M) => void
  signal: AbortSignal
  abortController: AbortController
}

export function createComponentInstance<S, M, E>(
  def: ComponentDef<S, M, E>,
  data?: unknown,
): ComponentInstance<S, M, E> {
  const [initialState, initialEffects] = (def.init as (data: unknown) => [S, E[]])(data)

  const controller = new AbortController()

  const inst: ComponentInstance<S, M, E> = {
    def,
    state: initialState,
    initialEffects,
    rootScope: createScope(null),
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
  // Phase 1 — structural reconciliation
  const blocks = inst.structuralBlocks
  const blocksLen = blocks.length
  for (let bi = 0; bi < blocksLen; bi++) {
    const block = blocks[bi]!
    if ((block.mask & combinedDirty) === 0) continue
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

  // Set dirty mask for memo() accessors used in structural blocks/bindings
  setCurrentDirtyMask(dirty)

  if (method >= 0) {
    const bl = inst.structuralBlocks
    for (let i = 0; i < bl.length; i++) {
      if (!(bl[i]!.mask & dirty)) continue
      const block = bl[i]!
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

  // User onEffect handler
  if (inst.def.onEffect) {
    inst.def.onEffect({ effect, send: inst.send, signal: inst.signal })
  }
}
