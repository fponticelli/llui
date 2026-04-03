import type { Scope, Binding } from './types'

let nextId = 1

// Shared empty arrays — avoid allocating per scope when unused
const EMPTY_SCOPES: Scope[] = []
const EMPTY_DISPOSERS: Array<() => void> = []
const EMPTY_BINDINGS: Binding[] = []
const EMPTY_UPDATERS: Array<() => void> = []

export function createScope(parent: Scope | null): Scope {
  const scope: Scope = {
    id: nextId++,
    parent,
    children: EMPTY_SCOPES,
    disposers: EMPTY_DISPOSERS,
    bindings: EMPTY_BINDINGS,
    eachItemStable: false,
    itemUpdaters: EMPTY_UPDATERS,
  }

  if (parent) {
    if (parent.children === EMPTY_SCOPES) parent.children = []
    parent.children.push(scope)
  }

  return scope
}

export function disposeScope(scope: Scope): void {
  if (scope.disposers.length === 0 && scope.children.length === 0 && scope.bindings.length === 0) {
    removeFromParent(scope)
    return
  }

  const children = scope.children.slice()
  for (const child of children) {
    disposeScope(child)
  }

  for (const disposer of scope.disposers) {
    disposer()
  }

  // Mark bindings as dead — Phase 2 will skip them
  for (const binding of scope.bindings) {
    binding.dead = true
  }

  scope.disposers.length = 0
  scope.bindings.length = 0
  scope.children.length = 0
  scope.itemUpdaters.length = 0

  removeFromParent(scope)
}

export function addBinding(scope: Scope, binding: Binding): void {
  binding.ownerScope = scope
  if (scope.bindings === EMPTY_BINDINGS) scope.bindings = []
  scope.bindings.push(binding)
}

export function addItemUpdater(scope: Scope, updater: () => void): void {
  if (scope.itemUpdaters === EMPTY_UPDATERS) scope.itemUpdaters = []
  scope.itemUpdaters.push(updater)
}

export function addDisposer(scope: Scope, disposer: () => void): void {
  if (scope.disposers === EMPTY_DISPOSERS) scope.disposers = []
  scope.disposers.push(disposer)
}

function removeFromParent(scope: Scope): void {
  if (scope.parent) {
    const idx = scope.parent.children.indexOf(scope)
    if (idx !== -1) {
      scope.parent.children.splice(idx, 1)
    }
  }
}
