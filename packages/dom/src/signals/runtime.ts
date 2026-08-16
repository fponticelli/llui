// Signal runtime — the binding driver for signal-compiled components.
//
// This chunked-mask driver is the ONLY binding path; the pre-signal two-word
// mask/maskHi runtime it replaced has been deleted.
//
// Each binding pairs a sparse chunked mask (which dependency bits it reads) with
// a `produce(state)` (the compiled accessor expression) and a `commit(value)`
// (the DOM mutation). On update the driver:
//   1. computes the dirty chunk-set from old→new state (ref-equality per path),
//   2. gates: skip any binding whose mask doesn't intersect dirty (never even
//      calls produce),
//   3. output-equality: calls produce, commits only if the value actually
//      changed — so a coarse dependency wastes a produce but never a DOM write.
//
// Step 3 belongs to `ValueBinding` only. A `StructuralBinding` (`show`/`branch`/
// `each`/`virtualEach`) has an IDENTITY `produce`, because its `commit` reconciles
// arms/rows against the whole state. The discriminated union keeps that state out
// of the value-only output-equality path by construction. Structural reconciles
// de-duplicate internally (`ArmController.switchTo` short-circuits on an unchanged
// arm key; `each` has its own same-structure fast path).
//
// See docs/proposals/signals/README.md "Runtime — output equality check".

import { type PathTable, type SparseMask, computeDirtyInto, intersects } from './mask.js'
import { isFrameworkError } from './framework-error.js'

/** A binding-evaluation failure surfaced to a `setOnBindingError` hook. Shape
 * matches the agent's dispatch-envelope `drain.errors` entries. */
export interface BindingError {
  kind: string
  key?: string
  message: string
  stack?: string
}

/** What the runtime was doing when the reported throw happened: evaluating a
 * binding, or notifying a `subscribe()` listener after the commit. `kind` stays
 * a plain `string` on the wire-shaped {@link BindingError} (the agent re-maps it
 * into its own envelope), but the runtime only ever produces these two. */
export type BindingErrorKind = 'binding' | 'subscriber'

// Depth of commit ROUNDS currently in flight. A round is opened by
// `component.ts`'s `commitToDom` around its `mount.update(next)` — the one place a
// reconcile is driven — so a non-zero depth means "a settle round is reconciling
// right now". `mount()` reads it to decide whether it may contain a throw.
//
// Kept here rather than read out of `commit-scope.ts` deliberately: that module's
// guard/queue/effect-frame state is private and reachable only through a
// `CommitToken`, and a read-only peephole into it would be a second way to observe
// scheduler state. This is one integer owned by the binding driver that needs it.
let commitRoundDepth = 0

/** Mark `fn` as the DOM work of a commit round — see {@link commitRoundDepth} and
 * `SignalScopeImpl.mount`. Costs one try/finally per ROUND (not per scope, not per
 * binding), so it is off the hot per-row path entirely. */
export function withCommitRound(fn: () => void): void {
  commitRoundDepth++
  try {
    fn()
  } finally {
    commitRoundDepth--
  }
}

// Active binding-error handler stack. A component installs its handler around
// its synchronous mount + every send (both of which run all binding produce/
// commit work), so the stack top always attributes a throw to the right
// component — updates are synchronous and non-reentrant under TEA.
const errorHandlers: Array<(e: BindingError) => void> = []

/** Run `fn` with `handler` active for any binding throw it triggers. */
export function withBindingErrors(
  handler: ((e: BindingError) => void) | null,
  fn: () => void,
): void {
  if (!handler) {
    fn()
    return
  }
  errorHandlers.push(handler)
  try {
    fn()
  } finally {
    errorHandlers.pop()
  }
}

/** Shape an arbitrary throw into the {@link BindingError} envelope a
 * `setOnBindingError` hook receives. Exported because not every isolated throw
 * happens INSIDE a `withBindingErrors` scope: the component's post-commit
 * subscriber sweep runs after that scope has exited, so it has to reach its
 * handler directly instead of through the stack (see `commitToDom`). Routing
 * it through this one shaper keeps the envelope — and therefore the agent's
 * `drain.errors` entries — identical whichever path reports. */
export function toBindingError(err: unknown, kind: BindingErrorKind): BindingError {
  const e = err as { message?: unknown; stack?: unknown }
  return {
    kind,
    message: typeof e?.message === 'string' ? e.message : String(err),
    stack: typeof e?.stack === 'string' ? e.stack : undefined,
  }
}

/** Surface an isolated binding throw. Mirrors `component.ts`'s
 * `reportSubscriberError` deliberately, and for the same reason:
 *
 *  - The console write is UNCONDITIONAL (not dev-gated). Containing a throw is
 *    only an improvement while it stays VISIBLE — a dev-gated log would make the
 *    throw vanish completely in a prod build with no hook installed, which is
 *    strictly worse than the escape it replaces (that at least reached
 *    `window.onerror`). #165 is precisely what invisible-and-contained costs.
 *  - The hook is tooling too (the agent bridge installs one), so a throw FROM it
 *    would escape the very loop that is containing the binding's throw. Contain
 *    it here or the fix reopens its own hole.
 *
 * SCOPE, because it is wider than "the mount boundary": this is the ONE reporter
 * for both containment paths, so the console write also fires on the UPDATE path
 * whenever a `setOnBindingError` hook is installed — i.e. once per contained
 * binding throw in every agent/devtools session, where previously only the hook
 * saw it. That is deliberate (the hook is a machine channel; a human debugging the
 * same session should not have to install one to see the throw) and it is the
 * reason the two paths share this function rather than each rolling their own. */
function reportBindingError(err: unknown): void {
  console.error(
    `[llui] a binding threw and was isolated — the DOM it writes keeps its prior ` +
      `value and the sibling bindings still ran.`,
    err,
  )
  const handler = errorHandlers[errorHandlers.length - 1]
  if (!handler) return
  try {
    handler(toBindingError(err, 'binding'))
  } catch (hookErr) {
    console.error(
      `[llui] the setOnBindingError hook threw while reporting a binding error. ` +
        `It was isolated too.`,
      hookErr,
    )
  }
}

/** The behavioral half of a binding: the accessor + the DOM write. The scope
 * holds these alongside a PARALLEL `masks` array (one {@link SparseMask} per
 * binding, lockstep by index) instead of wrapping each pair into a
 * `{ mask, produce, commit }` object — `each` builds one scope per ROW, so the
 * per-binding wrapper was an allocation per binding per row (2 extra objects
 * per jfb row, 20k on a create-10k). The caller's spec objects (compiler
 * `BindingSpec`s / `DirectRow.bindings`) are stored as-is.
 *
 * A DOM-value binding's produced output is eligible for output-equality. */
export interface ValueBinding<V = unknown> {
  /** evaluate the compiled accessor expression against the current state */
  produce(state: unknown): V
  /** apply the produced value (DOM mutation) — called only when it changed */
  commit(value: V): void
  /** Discriminant: omitted by the ordinary value specs emitted on the hot path. */
  structural?: false
}

/** A structural reconciler. Its identity-produced state is never output-compared. */
export interface StructuralBinding {
  /** A structural primitive's binding (`show`/`branch`/`each`/`virtualEach`): its
   * `produce` is the IDENTITY function, because `commit` reconciles arms/rows (and
   * owns their child scopes) and so needs the whole state to mount them against.
   *
   * Structural specs make themselves row-aware at build time (see
   * `BuildCtx.inRow`), so the enclosing `each`'s value-spec rebasing must SKIP
   * them rather than rewrite their identity produce. */
  structural: true
  /** pass the whole state through to the structural reconciler */
  produce(state: unknown): unknown
  /** reconcile arms/rows against the current state */
  commit(state: unknown): void
}

export type SignalBinding<V = unknown> = ValueBinding<V> | StructuralBinding

/** Value-only update path. Its parameter excludes `StructuralBinding`, making the
 * output-equality check statically unreachable for a structural reconcile. */
function updateValueBinding(
  binding: ValueBinding,
  state: unknown,
  last: unknown[],
  index: number,
): void {
  const value = binding.produce(state)
  if (Object.is(value, last[index])) return
  binding.commit(value)
  last[index] = value
}

/** Structural-only update path. Keep advancing `last`: although structural
 * bindings never read the slot, retaining mount-time state for the scope's whole
 * lifetime would be a leak. */
function updateStructuralBinding(
  binding: StructuralBinding,
  state: unknown,
  last: unknown[],
  index: number,
): void {
  const value = binding.produce(state)
  binding.commit(value)
  last[index] = value
}

export interface SignalScope {
  /** mount: run every binding once against the initial state. A binding that
   * THROWS is contained to itself — reported (console + any `setOnBindingError`
   * hook) and skipped, so its siblings still mount rather than the fragment being
   * abandoned half-drawn (#165). This holds with or without a hook installed;
   * {@link SignalScope.update} is the asymmetric half. */
  mount(state: unknown): void
  /** update: gate by dirty bits, output-compare value bindings, always commit
   * structural bindings whose gate passes, then propagate to the child scopes that
   * were present when this update began. Children mounted during the update are
   * already current from mount and join the next update's cohort. */
  update(oldState: unknown, newState: unknown): void
  /** register a child scope that should receive the same state updates (e.g.
   * `show`/`branch` content that reads the owning component's state). */
  addChild(child: SignalScope): void
  removeChild(child: SignalScope): void
}

/**
 * A Phase-2 reconciler over a flat binding array gated by a chunked-mask path
 * table, plus a set of child scopes that receive propagated updates. `each` builds
 * one scope PER ROW, so this is a CLASS (one allocation per row, methods on the
 * prototype) rather than a closure-captured object literal (which allocated the
 * object PLUS four method closures per row) — ~50% less per-row create cost and
 * proportionally less GC pressure on large lists. `last`/`children`/
 * `pendingChildren`/`dirty` are instance fields with lazy-allocation discipline.
 */
class SignalScopeImpl implements SignalScope {
  // Last produced value per binding, indexed by binding POSITION (lockstep with
  // `bindings`) — no per-binding Map, no object-hash lookups in the hot loops.
  private readonly last: unknown[]
  // Child scopes (show/branch/each content). Lazy — a LEAF row (no structural
  // children, the common list-row case) never allocates a Set. `null` ⇒ none.
  private children: Set<SignalScope> | null = null
  // Children mounted while this scope is updating belong to the NEXT update
  // cohort. Lazy — the normal no-structural-change path allocates nothing.
  private pendingChildren: Set<SignalScope> | null = null
  private updateInProgress = false
  // Dirty chunk-set, reused across this scope's updates (update is synchronous and
  // non-reentrant per scope). Lazy — a row created and never individually updated
  // never allocates one.
  private dirty: Uint32Array | null = null

  constructor(
    private readonly table: PathTable,
    private readonly bindings: readonly SignalBinding[],
    // Lockstep with `bindings`: masks[i] gates bindings[i]. Shared across rows
    // of the same template (the each-site ScopeShape memo), so no per-row copy.
    private readonly masks: readonly SparseMask[],
  ) {
    this.last = new Array<unknown>(bindings.length)
  }

  // A mount OUTSIDE a commit round is guarded; a mount INSIDE one is not — unless a
  // `setOnBindingError` hook is installed, in which case it is guarded too. That
  // hooked case matches main in WHEN it engages, but not in what it does: this loop
  // re-throws an `LluiFrameworkError` (see below), which main's hooked mount path
  // reported and swallowed. The change is deliberate and in the fatal direction —
  // the taxonomy is uniform wherever a throw is caught — but it is a change, not
  // pre-existing behaviour.
  //
  // WHY GUARD AT ALL. A mount has no previous frame to fall back on. When a throw
  // escaped this loop the enclosing fragment was abandoned HALF-DRAWN and stayed
  // that way — the reporting incident rendered a header, a section heading and an
  // empty table, then nothing, reading as a confident "there is no data" (#165).
  // Nothing recovers from it: the DOM the loop already wrote is live, and no later
  // state change re-runs the bindings it never reached.
  //
  // WHY ONLY OUTSIDE A ROUND. Containing a throw inside a round changes the
  // SCHEDULE: the round completes instead of aborting, so its collected effects are
  // DISPATCHED where `commit-scope.ts` says a round that throws must drop them
  // (they would otherwise run `onEffect` against a half-reconciled DOM — and a
  // contained binding failure IS a partially-reconciled DOM, close enough to the
  // stated hazard that it must not be widened as a side effect of an unrelated
  // fix). A binding in a row/arm mounted during a round still throws directly from
  // this mount loop; deferring that fresh scope's child traversal until the next
  // update (#225) does not contain or reschedule the mount failure. The initial
  // mount — where the half-drawn document actually happens — is outside any commit
  // round and is fully covered.
  //
  // Structure: ONE try region for the whole guarded loop (re-entered only after a
  // throw, resuming at the next binding) rather than a try/catch PER BINDING — the
  // per-iteration wrapper is what main's fast path existed to avoid.
  mount(state: unknown): void {
    const { bindings, last } = this
    const n = bindings.length
    if (commitRoundDepth > 0 && errorHandlers.length === 0) {
      // Inside a round with no hook: main's path, verbatim. The throw propagates,
      // the round aborts, and its effects are dropped by `drain`.
      for (let i = 0; i < n; i++) {
        const b = bindings[i]!
        const v = b.produce(state)
        b.commit(v)
        last[i] = v
      }
      return
    }
    let i = 0
    while (i < n) {
      try {
        for (; i < n; i++) {
          const b = bindings[i]!
          const v = b.produce(state)
          b.commit(v)
          last[i] = v
        }
      } catch (err) {
        // A FRAMEWORK authoring invariant is not a data surprise and is NOT
        // contained: swallowing "a row cannot have a `show` as its top-level node"
        // mounts a tree that cannot be reconciled, and the failure then resurfaces
        // as a `NotFoundError` three interactions later — the displacement #165 is
        // filed about. See framework-error.ts.
        if (isFrameworkError(err)) throw err
        reportBindingError(err)
        i++ // skip the binding that threw; its `last` slot stays unwritten
      }
    }
  }

  update(oldState: unknown, newState: unknown): void {
    const childrenAtStart = this.children
    // A scope with no children at entry has no cohort to traverse. Run the binding
    // hot path without a per-scope try/finally; any children it mounts are added to
    // the live Set but deliberately wait for the next update.
    if (childrenAtStart === null) {
      this.updateBindings(oldState, newState)
      return
    }
    this.updateInProgress = true
    try {
      this.updateBindings(oldState, newState)
      // A removal mutates this live entry cohort immediately; additions are
      // deferred by addChild and cannot extend its Set iterator.
      for (const child of childrenAtStart) child.update(oldState, newState)
    } finally {
      this.updateInProgress = false
      const pending = this.pendingChildren
      if (pending !== null) {
        this.pendingChildren = null
        if (pending.size > 0) {
          const children = this.children ?? (this.children = new Set<SignalScope>())
          for (const child of pending) children.add(child)
        }
      }
    }
  }

  /** Binding-only hot path, split from child-cohort bookkeeping so leaf scopes
   * (the common `each` row) do not pay a try/finally on every update. */
  private updateBindings(oldState: unknown, newState: unknown): void {
    const { bindings, last, table, masks } = this
    // Skip the whole binding sweep when nothing this scope tracks changed — the
    // common case for an unchanged `each` row whose item ref is identical.
    const d = this.dirty ?? (this.dirty = new Uint32Array(table.chunkCount))
    if (computeDirtyInto(table, oldState, newState, d)) {
      const n = bindings.length
      // Fast path mirrors mount(): try/catch-free hot loop unless a hook is active.
      if (errorHandlers.length === 0) {
        for (let i = 0; i < n; i++) {
          if (!intersects(masks[i]!, d)) continue // gate: irrelevant binding
          const b = bindings[i]!
          if (b.structural === true) updateStructuralBinding(b, newState, last, i)
          else updateValueBinding(b, newState, last, i)
        }
      } else {
        for (let i = 0; i < n; i++) {
          if (!intersects(masks[i]!, d)) continue // gate: irrelevant binding
          const b = bindings[i]!
          try {
            if (b.structural === true) updateStructuralBinding(b, newState, last, i)
            else updateValueBinding(b, newState, last, i)
          } catch (err) {
            reportBindingError(err)
          }
        }
      }
    }
  }

  addChild(child: SignalScope): void {
    const target = this.updateInProgress
      ? (this.pendingChildren ??= new Set<SignalScope>())
      : (this.children ??= new Set<SignalScope>())
    target.add(child)
  }

  removeChild(child: SignalScope): void {
    const children = this.children
    if (children !== null) {
      children.delete(child)
      if (children.size === 0) this.children = null
    }
    this.pendingChildren?.delete(child)
  }
}

/**
 * Create a Phase-2 reconciler over a flat binding array gated by a chunked-mask
 * path table, plus a set of child scopes that receive propagated updates.
 * `masks` is lockstep with `bindings` (masks[i] gates bindings[i]) and is
 * typically a shared per-template array (the each-site ScopeShape memo).
 */
export function createSignalScope(
  table: PathTable,
  bindings: readonly SignalBinding[],
  masks: readonly SparseMask[],
): SignalScope {
  return new SignalScopeImpl(table, bindings, masks)
}
