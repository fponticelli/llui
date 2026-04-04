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
  const [initialState, initialEffects] = def.init(data)

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

function processMessages<S, M, E>(inst: ComponentInstance<S, M, E>): void {
  let state = inst.state
  let combinedDirty = 0
  const allEffects: E[] = []

  while (inst.queue.length > 0) {
    const msg = inst.queue.shift()!
    const [newState, effects] = inst.def.update(state, msg)
    const dirty = inst.def.__dirty ? inst.def.__dirty(state, newState) : FULL_MASK
    if (typeof dirty === 'number') {
      combinedDirty |= dirty
    } else {
      combinedDirty |= dirty[0] | dirty[1]
    }
    state = newState
    allEffects.push(...effects)
  }

  inst.state = state
  inst.lastDirtyMask = combinedDirty
  inst.lastEffects = allEffects

  // Snapshot binding count before Phase 1 — bindings added during
  // Phase 1 already have correct initial values and skip Phase 2.
  const bindings = inst.allBindings
  const bindingsBeforePhase1 = bindings.length

  // Phase 1 — structural reconciliation (instance-local blocks)
  const snapshot = inst.structuralBlocks.slice()
  for (const block of snapshot) {
    block.reconcile(state, combinedDirty)
  }

  // Compact dead bindings before Phase 2 (Phase 1 may have disposed scopes)
  let phase2Len = bindingsBeforePhase1
  if (bindings.length > bindingsBeforePhase1 || (phase2Len > 0 && bindings[0]!.dead)) {
    let w = 0
    for (let r = 0; r < bindings.length; r++) {
      if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
    }
    bindings.length = w
    phase2Len = Math.min(w, bindingsBeforePhase1)
  }

  // Phase 2 — binding updates (flat array, no tree walk)
  // Only iterate bindings that existed before Phase 1.
  // Fresh bindings (created during Phase 1) already have initial values set.
  setCurrentDirtyMask(combinedDirty)
  if (combinedDirty !== 0) {
    const state = inst.state
    for (let i = 0, len = phase2Len; i < len; i++) {
      const binding = bindings[i]!
      if (binding.dead || (binding.mask & combinedDirty) === 0) continue
      const newValue = binding.accessor(state)
      if (Object.is(newValue, binding.lastValue)) continue
      binding.lastValue = newValue
      applyBinding(binding, newValue)
    }
  }

  // Dispatch effects after DOM updates
  for (const effect of allEffects) {
    dispatchEffect(inst, effect)
  }
}

function dispatchEffect<S, M, E>(
  inst: ComponentInstance<S, M, E>,
  effect: E,
): void {
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
    inst.def.onEffect(effect, inst.send, inst.signal)
  }
}
