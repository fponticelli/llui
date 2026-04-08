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
    itemUpdaters: EMPTY_UPDATERS,
  }

  if (parent) {
    if (parent.children === EMPTY_SCOPES) parent.children = []
    parent.children.push(scope)
  }

  return scope
}

/**
 * Dispose a scope and all its children. By default, detaches the scope
 * from its parent's `children` array via `indexOf + splice` — O(N) per
 * call, which becomes O(N²) when disposing many sibling scopes in bulk
 * (e.g. `each` clearing 1000 rows).
 *
 * Pass `skipParentRemoval = true` when the caller will batch-remove
 * children afterwards (see `removeOrphanedFromParent`). The scope's
 * `parent` pointer is still set to `null` so the caller can identify
 * orphaned entries.
 */
export function disposeScope(scope: Scope, skipParentRemoval = false): void {
  if (scope.disposers.length === 0 && scope.children.length === 0 && scope.bindings.length === 0) {
    if (!skipParentRemoval) removeFromParent(scope)
    scope.parent = null
    return
  }

  // When skipParentRemoval is true, children don't mutate during disposal —
  // iterate directly without allocating a copy. Otherwise, clone to avoid
  // mutation during iteration.
  const children = skipParentRemoval ? scope.children : scope.children.slice()
  for (const child of children) {
    disposeScope(child, skipParentRemoval)
  }

  for (const disposer of scope.disposers) {
    disposer()
  }

  // Mark bindings as dead and break closure/DOM retention
  for (const binding of scope.bindings) {
    binding.dead = true
    binding.accessor = null!
    binding.node = null!
    binding.lastValue = undefined
  }

  scope.disposers.length = 0
  scope.bindings.length = 0
  scope.children.length = 0
  scope.itemUpdaters.length = 0

  if (!skipParentRemoval) removeFromParent(scope)
  scope.parent = null
}

/**
 * Batch-remove children with `parent === null` from `parent.children`.
 * Called after a bulk `disposeScope(child, true)` pass to collapse the
 * individual O(N) splice operations into one O(N) scan.
 */
export function removeOrphanedChildren(parent: Scope): void {
  const children = parent.children
  let w = 0
  for (let r = 0; r < children.length; r++) {
    if (children[r]!.parent !== null) children[w++] = children[r]!
  }
  children.length = w
}

/**
 * Bulk dispose an array of sibling scopes — avoids per-scope function call
 * overhead. Used by each() clear path where 1000+ scopes are disposed at once.
 * Caller must call removeOrphanedChildren(parent) afterwards.
 */
export function disposeScopesBulk(scopes: Scope[]): void {
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]!
    // Recursively dispose children
    const children = scope.children
    if (children.length > 0) {
      disposeScopesBulk(children)
    }
    // Run disposers
    const disposers = scope.disposers
    for (let d = 0; d < disposers.length; d++) disposers[d]!()
    // Mark bindings dead
    const bindings = scope.bindings
    for (let b = 0; b < bindings.length; b++) {
      const binding = bindings[b]!
      binding.dead = true
      binding.accessor = null!
      binding.node = null!
      binding.lastValue = undefined
    }
    // Clear all arrays + detach from parent
    scope.disposers = EMPTY_DISPOSERS
    scope.bindings = EMPTY_BINDINGS
    scope.children = EMPTY_SCOPES
    scope.itemUpdaters = EMPTY_UPDATERS
    scope.parent = null
  }
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

/**
 * Register a per-item updater that compares the new value against the last
 * value before applying. Shared by `text()`, `elSplit()`, and `elTemplate()`
 * so the equality-check logic lives in one place.
 *
 * @param apply - DOM write: receives the new value when it differs
 * @returns the initial value (caller should apply it to the DOM)
 */
export function addCheckedItemUpdater<V>(scope: Scope, get: () => V, apply: (value: V) => void): V {
  let last: V = get()
  addItemUpdater(scope, () => {
    const v = get()
    if (v === last || (v !== v && last !== last)) return
    last = v
    apply(v)
  })
  return last
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
