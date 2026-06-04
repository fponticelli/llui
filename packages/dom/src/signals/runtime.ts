// Signal runtime — the Phase-2 binding driver for signal-compiled components.
//
// Built ALONGSIDE the existing mask/maskHi runtime (per-file-flip migration):
// signal-compiled components use this chunked-mask driver; legacy components keep
// the existing gate until migrated. No change to the live binding path.
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

function reportBindingError(err: unknown): void {
  const handler = errorHandlers[errorHandlers.length - 1]
  if (!handler) return
  const e = err as { message?: unknown; stack?: unknown }
  handler({
    kind: 'binding',
    message: typeof e?.message === 'string' ? e.message : String(err),
    stack: typeof e?.stack === 'string' ? e.stack : undefined,
  })
}

export interface SignalBinding<V = unknown> {
  /** the chunks/bits this binding depends on */
  readonly mask: SparseMask
  /** evaluate the compiled accessor expression against the current state */
  produce(state: unknown): V
  /** apply the produced value (DOM mutation) — called only when it changed */
  commit(value: V): void
}

export interface SignalScope {
  /** mount: run every binding once against the initial state */
  mount(state: unknown): void
  /** update: gate by dirty bits, commit only changed values, then propagate to
   * child scopes (mounted content of conditional/structural primitives). */
  update(oldState: unknown, newState: unknown): void
  /** register a child scope that should receive the same state updates (e.g.
   * `show`/`branch` content that reads the owning component's state). */
  addChild(child: SignalScope): void
  removeChild(child: SignalScope): void
}

/**
 * Create a Phase-2 reconciler over a flat binding array gated by a chunked-mask
 * path table, plus a set of child scopes that receive propagated updates.
 */
export function createSignalScope(
  table: PathTable,
  bindings: readonly SignalBinding[],
): SignalScope {
  const last = new Map<SignalBinding, unknown>()
  const children = new Set<SignalScope>()
  // Reused across updates (update is synchronous and non-reentrant per scope),
  // so a hot reconcile allocates no dirty masks.
  const dirty = new Uint32Array(table.chunkCount)

  return {
    mount(state: unknown): void {
      // Fast path: no binding-error hook installed (the common case). Run the
      // hottest loop in the runtime WITHOUT a per-iteration try/catch — that
      // wrapper is a V8 optimization barrier, and a throw here propagates by
      // default exactly as before. The safe path (below) is taken only while a
      // hook is active (agent/debug sessions), where it reports + continues.
      if (errorHandlers.length === 0) {
        for (const b of bindings) {
          const v = b.produce(state)
          b.commit(v)
          last.set(b, v)
        }
        return
      }
      for (const b of bindings) {
        try {
          const v = b.produce(state)
          b.commit(v)
          last.set(b, v)
        } catch (err) {
          // Hook installed: report and continue siblings, leaving this binding's
          // last value untouched (DOM keeps its prior value).
          reportBindingError(err)
        }
      }
    },

    update(oldState: unknown, newState: unknown): void {
      // Skip the whole binding sweep when nothing this scope tracks changed —
      // the common case for an unchanged `each` row whose item ref is identical.
      if (computeDirtyInto(table, oldState, newState, dirty)) {
        // Fast path mirrors mount(): try/catch-free hot loop unless a
        // binding-error hook is active.
        if (errorHandlers.length === 0) {
          for (const b of bindings) {
            if (!intersects(b.mask, dirty)) continue // gate: irrelevant binding
            const v = b.produce(newState)
            if (!Object.is(v, last.get(b))) {
              b.commit(v) // output-equality: only commit real changes
              last.set(b, v)
            }
          }
        } else {
          for (const b of bindings) {
            if (!intersects(b.mask, dirty)) continue // gate: irrelevant binding
            try {
              const v = b.produce(newState)
              if (!Object.is(v, last.get(b))) {
                b.commit(v) // output-equality: only commit real changes
                last.set(b, v)
              }
            } catch (err) {
              reportBindingError(err)
            }
          }
        }
      }
      // propagate to mounted child scopes (own bindings above may have
      // added/removed children; newly-mounted children are already current and
      // no-op here via output-equality).
      for (const c of children) c.update(oldState, newState)
    },

    addChild(child: SignalScope): void {
      children.add(child)
    },
    removeChild(child: SignalScope): void {
      children.delete(child)
    },
  }
}
