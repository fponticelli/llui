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
// Step 3 applies to VALUE bindings only. A STRUCTURAL binding (`show`/`branch`/
// `each`/`virtualEach`) has an IDENTITY `produce`, because its `commit` reconciles
// arms/rows and needs the whole state to mount them against — so output-equality
// would compare the STATE BUFFER's identity, not the binding's output. Inside an
// `each` row that buffer is one of two recycled ctx objects the row rotates on
// every update, while `last[i]` advances only on commit: a single gated-out row
// update desynchronises the two, and from then on `produce()` returns the very
// object already in `last[i]`, suppressing every later reconcile (issue #52 — a
// `branch` that stops swapping arms after an odd number of unrelated row updates).
// Structural bindings are therefore exempt: they are already gated by their deps,
// and they de-duplicate internally (`ArmController.switchTo` short-circuits on an
// unchanged arm key; `each`'s reconcile has its own same-structure fast path).
//
// See docs/proposals/signals/README.md "Runtime — output equality check".

import { type PathTable, type SparseMask, computeDirtyInto, intersects } from './mask.js'

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

function reportBindingError(err: unknown): void {
  const handler = errorHandlers[errorHandlers.length - 1]
  if (!handler) return
  handler(toBindingError(err, 'binding'))
}

/** The behavioral half of a binding: the accessor + the DOM write. The scope
 * holds these alongside a PARALLEL `masks` array (one {@link SparseMask} per
 * binding, lockstep by index) instead of wrapping each pair into a
 * `{ mask, produce, commit }` object — `each` builds one scope per ROW, so the
 * per-binding wrapper was an allocation per binding per row (2 extra objects
 * per jfb row, 20k on a create-10k). The caller's spec objects (compiler
 * `BindingSpec`s / `DirectRow.bindings`) are stored as-is. */
export interface SignalBinding<V = unknown> {
  /** evaluate the compiled accessor expression against the current state */
  produce(state: unknown): V
  /** apply the produced value (DOM mutation) — called only when it changed
   * (always, for a {@link SignalBinding.structural} binding) */
  commit(value: V): void
  /** A structural primitive's binding (`show`/`branch`/`each`/`virtualEach`): its
   * `produce` is the IDENTITY function, because `commit` reconciles arms/rows (and
   * owns their child scopes) and so needs the whole state to mount them against.
   *
   * Two consequences, both load-bearing:
   *  - RUNTIME: such a binding is EXEMPT from the output-equality check — see
   *    {@link SignalScope.update} and the file header.
   *  - BUILD: structural specs make themselves row-aware at build time (see
   *    `BuildCtx.inRow`), so the enclosing `each`'s value-spec rebasing must SKIP
   *    them rather than rewrite their identity produce. */
  structural?: boolean
}

export interface SignalScope {
  /** mount: run every binding once against the initial state */
  mount(state: unknown): void
  /** update: gate by dirty bits, commit only changed values (STRUCTURAL bindings
   * commit whenever their gate passes — see {@link SignalBinding.structural}), then
   * propagate to child scopes (mounted content of conditional/structural primitives). */
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
 * proportionally less GC pressure on large lists. `last`/`children`/`dirty` are
 * instance fields with the same lazy-allocation discipline as before.
 */
class SignalScopeImpl implements SignalScope {
  // Last produced value per binding, indexed by binding POSITION (lockstep with
  // `bindings`) — no per-binding Map, no object-hash lookups in the hot loops.
  private readonly last: unknown[]
  // Child scopes (show/branch/each content). Lazy — a LEAF row (no structural
  // children, the common list-row case) never allocates a Set. `null` ⇒ none.
  private children: Set<SignalScope> | null = null
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

  mount(state: unknown): void {
    const { bindings, last } = this
    const n = bindings.length
    // Fast path: no binding-error hook installed (the common case). Run the
    // hottest loop in the runtime WITHOUT a per-iteration try/catch — that wrapper
    // is a V8 optimization barrier, and a throw here propagates by default exactly
    // as before. The safe path is taken only while a hook is active (agent/debug).
    if (errorHandlers.length === 0) {
      for (let i = 0; i < n; i++) {
        const b = bindings[i]!
        const v = b.produce(state)
        b.commit(v)
        last[i] = v
      }
      return
    }
    for (let i = 0; i < n; i++) {
      const b = bindings[i]!
      try {
        const v = b.produce(state)
        b.commit(v)
        last[i] = v
      } catch (err) {
        // Hook installed: report and continue siblings, leaving this binding's
        // last value untouched (DOM keeps its prior value).
        reportBindingError(err)
      }
    }
  }

  update(oldState: unknown, newState: unknown): void {
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
          const v = b.produce(newState)
          if (b.structural === true || !Object.is(v, last[i])) {
            b.commit(v) // output-equality: only commit real changes
            // Structural bindings never READ `last[i]` (the check above short-
            // circuits), but keep writing it: the slot would otherwise pin the
            // MOUNT-time state object for the scope's lifetime.
            last[i] = v
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          if (!intersects(masks[i]!, d)) continue // gate: irrelevant binding
          const b = bindings[i]!
          try {
            const v = b.produce(newState)
            if (b.structural === true || !Object.is(v, last[i])) {
              b.commit(v) // output-equality: only commit real changes
              last[i] = v
            }
          } catch (err) {
            reportBindingError(err)
          }
        }
      }
    }
    // propagate to mounted child scopes (own bindings above may have added/removed
    // children; newly-mounted children are already current and no-op via output-eq).
    if (this.children !== null) for (const c of this.children) c.update(oldState, newState)
  }

  addChild(child: SignalScope): void {
    ;(this.children ??= new Set<SignalScope>()).add(child)
  }

  removeChild(child: SignalScope): void {
    this.children?.delete(child)
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
