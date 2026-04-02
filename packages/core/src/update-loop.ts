import type { ComponentDef, Scope } from './types'
import type { StructuralBlock } from './structural'
import { createScope } from './scope'
import { applyBinding } from './binding'

export const FULL_MASK = 0xffffffff | 0

export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  def: ComponentDef<S, M, E>
  state: S
  initialEffects: E[]
  rootScope: Scope
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

  // Phase 2 — binding updates
  if (combinedDirty !== 0) {
    runPhase2(inst.rootScope, inst.state, combinedDirty)
  }
}

function runPhase2(rootScope: Scope, state: unknown, dirtyMask: number): void {
  collectBindings(rootScope, (binding) => {
    if ((binding.mask & dirtyMask) === 0) return
    if (binding.perItem && binding.ownerScope.eachItemStable) return
    const newValue = binding.accessor(state)
    if (Object.is(newValue, binding.lastValue)) return
    binding.lastValue = newValue
    applyBinding(binding, newValue)
  })
}

function collectBindings(scope: Scope, cb: (binding: Scope['bindings'][number]) => void): void {
  for (const binding of scope.bindings) {
    cb(binding)
  }
  for (const child of scope.children) {
    collectBindings(child, cb)
  }
}
