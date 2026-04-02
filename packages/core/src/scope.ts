import type { Scope, Binding } from './types'

let nextId = 1

export function createScope(parent: Scope | null): Scope {
  const scope: Scope = {
    id: nextId++,
    parent,
    children: [],
    disposers: [],
    bindings: [],
    eachItemStable: false,
  }

  if (parent) {
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

  removeFromParent(scope)
}

export function addBinding(scope: Scope, binding: Binding): void {
  binding.ownerScope = scope
  scope.bindings.push(binding)
}

function removeFromParent(scope: Scope): void {
  if (scope.parent) {
    const idx = scope.parent.children.indexOf(scope)
    if (idx !== -1) {
      scope.parent.children.splice(idx, 1)
    }
  }
}
