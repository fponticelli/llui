import type { Lifetime, Binding } from './types.js'
import type { ComponentInstance } from './update-loop.js'
import { currentAccessor } from './render-context.js'

let nextId = 1

/**
 * Walk up the scope chain to find the owning ComponentInstance. The
 * instance is stamped onto the rootLifetime by `installDevTools`, so this
 * returns null in production (no devtools) or for scopes that haven't
 * yet been parented to a tracked root (e.g., during initial creation).
 */
function findInstance(scope: Lifetime): ComponentInstance | null {
  let s: Lifetime | null = scope
  while (s) {
    if (s.instance) return s.instance
    s = s.parent
  }
  return null
}

/**
 * Report a disposer throw. Same contract as `runDisposers` below; split
 * out as a non-inlinable slow path so the happy-path loop body stays
 * free of error-handling code.
 *
 * Dev: console.error + queue panic. Prod: silent (install
 * `_onBindingError` for structured reporting).
 */
function reportDisposerError(e: unknown, scope: Lifetime): void {
  const err = e instanceof Error ? e : new Error(String(e))
  const stack = err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : undefined
  const inst = findInstance(scope)
  if (inst !== null && inst._onBindingError !== undefined) {
    try {
      inst._onBindingError({
        kind: 'disposer',
        message: `${err.name}: ${err.message}`,
        stack,
      })
    } catch {
      // hook itself threw — already in recovery; nothing else to do
    }
    return
  }
  if (import.meta.env?.DEV) {
    if (inst !== null && inst._devPendingPanic === undefined) {
      inst._devPendingPanic = {
        message: `${err.name}: ${err.message}`,
        stack,
        accessor: currentAccessor(),
      }
    }
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error(
        `[llui] disposer threw during lifetime cleanup: ${err.name}: ${err.message}` +
          (stack ? `\n${stack}` : ''),
      )
    }
  }
}

/**
 * Run every disposer in `disposers`, with full error containment. A
 * throw in one disposer MUST NOT abort the loop — the remaining
 * disposers and the subsequent binding-dead-marking pass are
 * load-bearing for memory safety and reconciliation correctness (the
 * original Issue 1 symptom: "stale fact-row bindings alive after
 * navigate, which threw during reconcile" turned out to be downstream
 * of a disposer throw that left bindings unflagged in the parent's
 * flatBindings array).
 *
 * Shape: outer `while` + inner `for` + single `try/catch`. The happy
 * path executes the inner `for` to completion with one try frame for
 * the whole loop — no per-iteration try/catch overhead. On throw, the
 * catch reports the error, skips the failing disposer, and the outer
 * `while` restarts the inner loop at the next index. Worst case
 * (every disposer throws) costs N try/catch entries, same as the old
 * per-call wrapper; common case (no disposer throws) costs ONE.
 *
 * Hot path: `each.reconcileClear` / row-removal disposes 1000+ row
 * scopes at a time in jfb's clear1k_x8 / remove benchmarks. The
 * happy-path optimization here is what makes that cheap.
 */
function runDisposers(disposers: Array<() => void>, scope: Lifetime): void {
  let i = 0
  const len = disposers.length
  while (i < len) {
    const startedAt = i
    try {
      for (; i < len; i++) disposers[i]!()
    } catch (e) {
      reportDisposerError(e, scope)
      // Skip the disposer that threw. If V8 didn't bump `i` past the
      // failing one yet (caught mid-call), advance manually.
      if (i === startedAt) i = startedAt + 1
      else i++
    }
  }
}

// Shared empty arrays — avoid allocating per scope when unused
const EMPTY_LIFETIMES: Lifetime[] = []
const EMPTY_DISPOSERS: Array<() => void> = []
const EMPTY_BINDINGS: Binding[] = []
const EMPTY_UPDATERS: Array<() => void> = []

// Lifetime pool — reuse disposed scope objects to reduce GC pressure.
// Capped to avoid memory leaks in apps that create/destroy thousands of rows.
const SCOPE_POOL: Lifetime[] = []
const SCOPE_POOL_MAX = 2048

// Dev-mode flag. Flipped to true by installDevTools() once any component
// instance has a disposer log. In production this stays false forever,
// and disposeLifetime skips findInstance entirely — zero cost.
let anyDisposerLogInstalled = false

/** @internal — called by devtools.ts::installDevTools */
export function _markDisposerLogInstalled(): void {
  anyDisposerLogInstalled = true
}

/** @internal Drain the scope pool — for testing only */
export function _drainScopePool(): void {
  SCOPE_POOL.length = 0
}

export function createLifetime(parent: Lifetime | null): Lifetime {
  let scope: Lifetime
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
      children: EMPTY_LIFETIMES,
      disposers: EMPTY_DISPOSERS,
      bindings: EMPTY_BINDINGS,
      itemUpdaters: EMPTY_UPDATERS,
    }
  }

  if (parent) {
    if (parent.children === EMPTY_LIFETIMES) parent.children = []
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
export function disposeLifetime(scope: Lifetime, skipParentRemoval = false): void {
  if (scope.disposers.length === 0 && scope.children.length === 0 && scope.bindings.length === 0) {
    // Dev-only: still emit a DisposerEvent for empty scopes — the log
    // is meant to capture every scope the app destroys, not only ones
    // that had attached work. Outer flag check keeps production (no
    // devtools ever installed) at true zero cost — no parent-chain walk.
    // Dev-only — wrapped in `import.meta.env?.DEV` so the bundler dead-
    // codes the whole block (including `findInstance` and the parent-
    // chain walk) in production. `anyDisposerLogInstalled` is a static
    // module-level flag never set to true in non-dev runs, so the
    // dropped branch was already unreachable; this guard makes the
    // unreachability bundler-visible.
    if (import.meta.env?.DEV && anyDisposerLogInstalled) {
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
    disposeLifetime(child, skipParentRemoval)
  }

  runDisposers(scope.disposers, scope)

  // Dev-only: emit disposer events into the owning instance's log.
  // Outer flag check keeps production (no devtools ever installed) at
  // true zero cost — skips the O(depth) parent-chain walk entirely.
  // Dev-only — see disposeLifetime for rationale.
  if (import.meta.env?.DEV && anyDisposerLogInstalled) {
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
  scope.children = EMPTY_LIFETIMES
  scope.itemUpdaters = EMPTY_UPDATERS

  if (!skipParentRemoval) removeFromParent(scope)
  scope.parent = null

  // Return to pool for reuse
  if (SCOPE_POOL.length < SCOPE_POOL_MAX) SCOPE_POOL.push(scope)
}

/**
 * Batch-remove children with `parent === null` from `parent.children`.
 * Called after a bulk `disposeLifetime(child, true)` pass to collapse the
 * individual O(N) splice operations into one O(N) scan.
 */
export function removeOrphanedChildren(parent: Lifetime): void {
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
export function disposeLifetimesBulk(scopes: Lifetime[]): void {
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i]!
    // Recursively dispose children
    const children = scope.children
    if (children.length > 0) {
      disposeLifetimesBulk(children)
    }
    // Run disposers
    runDisposers(scope.disposers, scope)
    // Dev-only: emit disposer events — same guard as disposeLifetime.
    // Dev-only — wrapped in `import.meta.env?.DEV` so the bundler dead-
    // codes the whole block (including `findInstance` and the parent-
    // chain walk) in production. `anyDisposerLogInstalled` is a static
    // module-level flag never set to true in non-dev runs, so the
    // dropped branch was already unreachable; this guard makes the
    // unreachability bundler-visible.
    if (import.meta.env?.DEV && anyDisposerLogInstalled) {
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
    scope.children = EMPTY_LIFETIMES
    scope.itemUpdaters = EMPTY_UPDATERS
    scope.parent = null
    if (SCOPE_POOL.length < SCOPE_POOL_MAX) SCOPE_POOL.push(scope)
  }
}

export function addBinding(scope: Lifetime, binding: Binding): void {
  binding.ownerLifetime = scope
  if (scope.bindings === EMPTY_BINDINGS) scope.bindings = []
  scope.bindings.push(binding)
}

export function addItemUpdater(scope: Lifetime, updater: () => void): void {
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
export function addCheckedItemUpdater<V>(
  scope: Lifetime,
  get: () => V,
  apply: (value: V) => void,
): V {
  let last: V = get()
  addItemUpdater(scope, () => {
    const v = get()
    if (v === last || (v !== v && last !== last)) return
    last = v
    apply(v)
  })
  return last
}

export function addDisposer(scope: Lifetime, disposer: () => void): void {
  if (scope.disposers === EMPTY_DISPOSERS) scope.disposers = []
  scope.disposers.push(disposer)
}

function removeFromParent(scope: Lifetime): void {
  if (scope.parent) {
    const idx = scope.parent.children.indexOf(scope)
    if (idx !== -1) {
      scope.parent.children.splice(idx, 1)
    }
  }
}
