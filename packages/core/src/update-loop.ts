import type { ComponentDef, Scope, Binding } from './types'
import type { StructuralBlock } from './structural'
import { createScope } from './scope'
import { applyBinding } from './binding'

export const FULL_MASK = 0xffffffff | 0

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
}

export function createComponentInstance<S, M, E>(
  def: ComponentDef<S, M, E>,
  data?: unknown,
): ComponentInstance<S, M, E> {
  const [initialState, initialEffects] = def.init(data)

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

  // Phase 1 — structural reconciliation (instance-local blocks)
  const snapshot = inst.structuralBlocks.slice()
  for (const block of snapshot) {
    block.reconcile(state, combinedDirty)
  }

  // Phase 2 — binding updates (flat array, no tree walk)
  if (combinedDirty !== 0) {
    const bindings = inst.allBindings
    const state = inst.state
    let deadCount = 0
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i]!
      if (binding.dead) { deadCount++; continue }
      if ((binding.mask & combinedDirty) === 0) continue
      if (binding.perItem && binding.ownerScope.eachItemStable) continue
      const newValue = binding.accessor(state)
      if (Object.is(newValue, binding.lastValue)) continue
      binding.lastValue = newValue
      applyBinding(binding, newValue)
    }
    // Compact when >25% dead
    if (deadCount > 0 && deadCount > bindings.length >> 2) {
      let w = 0
      for (let r = 0; r < bindings.length; r++) {
        if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
      }
      bindings.length = w
    }
  }
}
