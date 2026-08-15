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
  /** mount: run every binding once against the initial state. A binding that
   * THROWS is contained to itself — reported (console + any `setOnBindingError`
   * hook) and skipped, so its siblings still mount rather than the fragment being
   * abandoned half-drawn (#165). This holds with or without a hook installed;
   * {@link SignalScope.update} is the asymmetric half. */
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

  // MOUNT IS ALWAYS GUARDED; `update` (below) keeps its unguarded fast path. The
  // asymmetry is the design, not an oversight — see #165.
  //
  // A mount has NO PREVIOUS FRAME to fall back on. When a throw escapes this loop
  // the enclosing fragment is abandoned HALF-DRAWN and stays that way: the
  // reporting incident rendered a header, a section heading and an empty table,
  // then nothing — no rows, no totals, no footer, no error on screen, reading as a
  // confident "there is no data". Nothing recovers from that; the DOM the loop
  // already wrote is live and no later state change re-runs the bindings it never
  // reached. So one binding's throw is contained to that binding: its slot in
  // `last` stays untouched, every sibling still mounts, and the throw is REPORTED
  // (console + any hook) rather than swallowed.
  //
  // `update` deliberately does NOT get the same containment by default. A throw
  // there leaves the PREVIOUS, consistent frame in the DOM and aborts the settle
  // round, which drops that round's collected effects and propagates to the
  // `send` caller — schedule contract pinned by `test/signals/
  // scheduler-throw-path.test.ts` and spelled out in `commit-scope.ts`'s header.
  // Containment there is opt-in via `setOnBindingError`, exactly as before.
  //
  // Structure: ONE try region for the whole loop (re-entered only after a throw,
  // resuming at the next binding) rather than a try/catch PER BINDING. The
  // per-iteration wrapper was the thing the old fast path existed to avoid — this
  // shape keeps the throw-free path a single plain loop inside a single try.
  mount(state: unknown): void {
    const { bindings, last } = this
    const n = bindings.length
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
