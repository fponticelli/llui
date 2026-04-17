import type { Scope, Binding } from './types.js'
import type { ComponentInstance } from './update-loop.js'

let nextId = 1

/**
 * Walk up the scope chain to find the owning ComponentInstance. The
 * instance is stamped onto the rootScope by `installDevTools`, so this
 * returns null in production (no devtools) or for scopes that haven't
 * yet been parented to a tracked root (e.g., during initial creation).
 */
function findInstance(scope: Scope): ComponentInstance | null {
  let s: Scope | null = scope
  while (s) {
    if (s.instance) return s.instance
    s = s.parent
  }
  return null
}

// Shared empty arrays — avoid allocating per scope when unused
const EMPTY_SCOPES: Scope[] = []
const EMPTY_DISPOSERS: Array<() => void> = []
const EMPTY_BINDINGS: Binding[] = []
const EMPTY_UPDATERS: Array<() => void> = []

// Scope pool — reuse disposed scope objects to reduce GC pressure.
// Capped to avoid memory leaks in apps that create/destroy thousands of rows.
const SCOPE_POOL: Scope[] = []
const SCOPE_POOL_MAX = 2048

// Dev-mode flag. Flipped to true by installDevTools() once any component
// instance has a disposer log. In production this stays false forever,
// and disposeScope skips findInstance entirely — zero cost.
let anyDisposerLogInstalled = false

/** @internal — called by devtools.ts::installDevTools */
export function _markDisposerLogInstalled(): void {
  anyDisposerLogInstalled = true
}

/** @internal Drain the scope pool — for testing only */
export function _drainScopePool(): void {
  SCOPE_POOL.length = 0
}

export function createScope(parent: Scope | null): Scope {
  let scope: Scope
  if (SCOPE_POOL.length > 0) {
    scope = SCOPE_POOL.pop()!
    scope.id = nextId++
    scope.parent = parent
    // Arrays already reset to empties by dispose. Reset dev-only hints
    // so recycled scopes don't carry stale tagging/back-refs. Cheap
    // (two undefined writes) and keeps production-identical behavior
    // when these fields are never set.
    scope.disposalCause = undefined
    scope.instance = undefined
    scope._kind = undefined
  } else {
    scope = {
      id: nextId++,
      parent,
      children: EMPTY_SCOPES,
      disposers: EMPTY_DISPOSERS,
      bindings: EMPTY_BINDINGS,
      itemUpdaters: EMPTY_UPDATERS,
    }
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
    // Dev-only: still emit a DisposerEvent for empty scopes — the log
    // is meant to capture every scope the app destroys, not only ones
    // that had attached work. Outer flag check keeps production (no
    // devtools ever installed) at true zero cost — no parent-chain walk.
    if (anyDisposerLogInstalled) {
      const inst = findInstance(scope)
      if (inst?._disposerLog !== undefined) {
        inst._disposerLog.push({
          scopeId: String(scope.id),
          cause: scope.disposalCause ?? 'component-unmount',
          timestamp: Date.now(),
        })
      }
    }
    if (!skipParentRemoval) removeFromParent(scope)
    scope.parent = null
    // Don't pool empty scopes from the early-return path — they may be
    // disposed idempotently (twice), which would create pool duplicates
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

  // Dev-only: emit disposer events into the owning instance's log.
  // Outer flag check keeps production (no devtools ever installed) at
  // true zero cost — skips the O(depth) parent-chain walk entirely.
  if (anyDisposerLogInstalled) {
    const inst = findInstance(scope)
    if (inst?._disposerLog !== undefined) {
      inst._disposerLog.push({
        scopeId: String(scope.id),
        cause: scope.disposalCause ?? 'component-unmount',
        timestamp: Date.now(),
      })
    }
  }

  // Mark bindings as dead and break closure/DOM retention
  for (const binding of scope.bindings) {
    binding.dead = true
    binding.accessor = null!
    binding.node = null!
    binding.lastValue = undefined
  }

  // Reset to shared empties — don't just truncate, so pooled scopes
  // don't hold allocated-but-empty arrays
  scope.disposers = EMPTY_DISPOSERS
  scope.bindings = EMPTY_BINDINGS
  scope.children = EMPTY_SCOPES
  scope.itemUpdaters = EMPTY_UPDATERS

  if (!skipParentRemoval) removeFromParent(scope)
  scope.parent = null

  // Return to pool for reuse
  if (SCOPE_POOL.length < SCOPE_POOL_MAX) SCOPE_POOL.push(scope)
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
    // Dev-only: emit disposer events — same guard as disposeScope.
    if (anyDisposerLogInstalled) {
      const inst = findInstance(scope)
      if (inst?._disposerLog !== undefined) {
        inst._disposerLog.push({
          scopeId: String(scope.id),
          cause: scope.disposalCause ?? 'component-unmount',
          timestamp: Date.now(),
        })
      }
    }
    // Mark bindings dead
    const bindings = scope.bindings
    for (let b = 0; b < bindings.length; b++) {
      const binding = bindings[b]!
      binding.dead = true
      binding.accessor = null!
      binding.node = null!
      binding.lastValue = undefined
    }
    // Reset to shared empties + detach from parent + return to pool
    scope.disposers = EMPTY_DISPOSERS
    scope.bindings = EMPTY_BINDINGS
    scope.children = EMPTY_SCOPES
    scope.itemUpdaters = EMPTY_UPDATERS
    scope.parent = null
    if (SCOPE_POOL.length < SCOPE_POOL_MAX) SCOPE_POOL.push(scope)
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
