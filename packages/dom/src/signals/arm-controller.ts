// ArmController — the shared mounted-arm machine behind `show`, `branch`, and
// `lazy`'s error arm.
//
// `show` (arm key: `boolean`) and `branch` (arm key: `string`) were near-verbatim
// clones: each keeps at most one mounted arm — its OWN child signal scope, mounted
// on the owning component's state and registered as a child of the owner scope so
// it receives state updates while mounted. Toggling the key swaps arms (old arm
// unmounts, new arm mounts); a same-key update does NOT remount (the mounted arm's
// own scope handles inner reactivity). `lazy` reuses the same mount/teardown for
// its one-shot error arm.
//
// The controller owns the arm's lifecycle (build → insert → mount → addChild →
// onMount, and the reverse on swap/dispose); the CALLER owns where the arm inserts
// and how its region is cleared, so the same class serves the anchor-bracketed
// primitives (show/branch, cleared via `removeBetween`) and lazy's anchor-relative
// error region (cleared by removing the mounted nodes).

import { runBuild, runMounts, type BuildCtx, type SignalDoc } from './build-context.js'
import type { SignalScope } from './runtime.js'
import type { Renderable } from './element.js'
import { rebaseRowSpecs } from './row-rebase.js'
import { buildAndPublishScope } from './scope-build.js'
import type { TransitionOptions } from '../types.js'

/** Placement + teardown policy for an {@link ArmController}. The controller reads
 * `parent()`/`insertBefore()` fresh on every mount (anchors move as siblings come
 * and go) and calls `clear()` to remove a swapped-out arm's region. */
export interface ArmPlacement {
  doc: SignalDoc
  /** The enclosing build's ctx — arms build as nested builds inheriting it. */
  buildCtx: BuildCtx
  /** The owner scope: mounted arms are added/removed as its children. */
  ownerHost: { scope: SignalScope | null }
  /** Inside an `each` row: rebase arm VALUE specs to read `ctx.state`. */
  inRow: boolean
  /** The parent element the arm nodes insert into, or null when detached (the
   * controller then no-ops the swap — the reconcile ran off-DOM). */
  parent(): Node | null
  /** The node to insert arm nodes before (an end anchor, or `anchor.nextSibling`);
   * null appends at the end of `parent()`. Read fresh per mount. */
  insertBefore(): Node | null
  /** Remove the swapped-out arm's DOM region. Receives the arm's own nodes; a
   * bracketed primitive ignores them and clears between its anchors instead (which
   * also sweeps nested-structural content). */
  clear(nodes: readonly Node[]): void
  /** Optional element-level enter/leave hooks (see {@link TransitionOptions}). When
   * `leave` is provided the controller DEFERS node detachment + scope teardown of a
   * swapped-out arm until the returned promise resolves; `enter` runs post-mount on
   * a freshly-inserted arm. Absent (the default) ⇒ synchronous swap, byte-identical
   * to the pre-transition behavior. Never invoked under {@link ssr}. */
  transition?: TransitionOptions
  /** True during a server render — transitions never run (no live DOM / no frames).
   * The controller then always takes the synchronous path. */
  ssr?: boolean
  /** Snapshot the exact DOM footprint of the arm to detach LATER, when its `leave`
   * animation resolves. Captured at teardown time — BEFORE any replacement arm is
   * inserted — so it names only the leaving arm's nodes (its own PLUS any nested
   * structural content between the anchors), never the incoming arm's. Required
   * (with {@link detach}) for the deferred-leave path; when absent the controller
   * falls back to the synchronous {@link clear}. */
  collectRegion?(nodes: readonly Node[]): readonly Node[]
  /** Detach a set previously captured by {@link collectRegion}. */
  detach?(nodes: readonly Node[]): void
}

interface MountedArm<K> {
  key: K
  scope: SignalScope
  nodes: readonly Node[]
  teardowns: Array<() => void>
}

/** A swapped-out arm whose `leave` animation is still running: its scope + nodes are
 * kept alive and in the DOM until the promise resolves (or an interrupting switch /
 * dispose supersedes it — see {@link ArmController.finalizePendingLeaves}). */
interface PendingLeave {
  scope: SignalScope
  /** exact nodes to detach on finalize (captured before any replacement arm) */
  nodes: readonly Node[]
  teardowns: Array<() => void>
  /** guards against double-teardown when a superseding finalize races the promise */
  finalized: boolean
}

/**
 * Holds at most one mounted arm keyed by `K`. `switchTo` swaps to the arm for a new
 * key (or unmounts when `armFn` is undefined / a same-key call short-circuits);
 * `dispose` tears the current arm down. Behavior matches the former inline
 * show/branch reconcile + host-dispose teardown exactly.
 */
export class ArmController<K> {
  private mounted: MountedArm<K> | null = null
  // Arms whose `leave` animation is in flight. At most one accumulates in normal
  // use — a new switch finalizes any prior pending leaves first (see switchTo) — but
  // a Set keeps the finalize/resurrect bookkeeping robust regardless.
  private pendingLeaves: Set<PendingLeave> | null = null

  constructor(private readonly place: ArmPlacement) {}

  /** Is an arm currently mounted? (Test/introspection aid.) */
  get isMounted(): boolean {
    return this.mounted !== null
  }

  /** The currently-mounted arm's key, or null when none is mounted. */
  get currentKey(): K | null {
    return this.mounted ? this.mounted.key : null
  }

  /**
   * Reconcile to the arm for `key`. No-op when detached (no parent). A same-key
   * call short-circuits (the mounted arm's own scope handles its updates). Otherwise
   * the current arm (if any) is torn down and — when `armFn` is provided — the new
   * arm is built, inserted, mounted against `mountState`, registered as a child of
   * the owner scope, and its onMount callbacks run. `armFn` undefined mounts nothing
   * (the falsy `show` with no `orElse`, or an absent `branch` arm).
   */
  switchTo(key: K, armFn: (() => Renderable) | undefined, mountState: unknown): void {
    const parent = this.place.parent()
    if (!parent) return
    if (this.mounted && this.mounted.key === key) return // same arm — inner scope handles updates

    // Interruption safety: finalize any arm still animating out from a PRIOR switch
    // before starting a new one. This supersedes the pending leave (hard-detaching
    // its nodes + running its teardowns exactly once) so we never accumulate
    // overlapping leaving arms and the pending promise's later resolution is a
    // no-op (its `finalized` guard) — no double-teardown, no leaked nodes. The arm
    // we are about to leave (below) is created AFTER this, so it is not affected.
    this.finalizePendingLeaves()

    this.teardown(false)

    if (!armFn) return
    const built = runBuild(this.place.doc, armFn, this.place.buildCtx)
    if (this.place.inRow) built.specs = rebaseRowSpecs(built.specs) // value reads → ctx.state
    const scope = buildAndPublishScope(built)
    // Insert FIRST, then mount (bindings commit + first structural reconcile),
    // then run onMount — matching each's phase-3 and the top-level mount contract.
    // Committing a binding on a still-detached node silently drops selection-style
    // props (e.g. `<option selected>` needs its controlling <select> as a parent),
    // with no re-commit (output-equality holds the stale value).
    const ref = this.place.insertBefore()
    for (const n of built.nodes) parent.insertBefore(n, ref)
    scope.mount(mountState) // mount on the same (combined-ctx) state child-prop will feed
    this.place.ownerHost.scope?.addChild(scope) // receive future state updates while mounted
    runMounts(built.mounts, parent as Element, built.teardowns)
    this.mounted = { key, scope, nodes: built.nodes, teardowns: built.teardowns }
    // Post-mount enter hook: nodes are inserted and bindings committed. Skipped
    // under SSR (no live DOM). enter is fire-and-forget — the arm stays mounted
    // whether or not its enter animation has finished.
    if (!this.place.ssr && this.place.transition?.enter) {
      this.place.transition.enter(Array.from(built.nodes))
    }
  }

  /** Tear down the currently-mounted arm, if any (host dispose). Idempotent.
   * Finalizes synchronously — a `leave` animation must never hold DOM/scopes past
   * the owning component's unmount. */
  dispose(): void {
    this.finalizePendingLeaves()
    this.teardown(true)
  }

  /** Tear down the currently-mounted arm. With `immediate` false and a `leave` hook
   * present, DEFERS node detachment + scope teardown until `leave` resolves (the arm
   * animates out while a replacement may already be mounting); otherwise removes
   * synchronously — the byte-identical pre-transition path. */
  private teardown(immediate: boolean): void {
    const m = this.mounted
    if (!m) return
    this.mounted = null

    const leave = immediate || this.place.ssr ? undefined : this.place.transition?.leave
    if (leave && this.place.collectRegion && this.place.detach) {
      // Deferred leave: keep the arm's scope registered + its nodes in the DOM while
      // the animation runs. Capture the exact leaving footprint NOW (before any
      // replacement arm is inserted before the same anchor).
      const pending: PendingLeave = {
        scope: m.scope,
        nodes: this.place.collectRegion(m.nodes),
        teardowns: m.teardowns,
        finalized: false,
      }
      ;(this.pendingLeaves ??= new Set()).add(pending)
      const result = leave(Array.from(pending.nodes))
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).then(() => this.finalizeLeave(pending))
      } else {
        // A `leave` that returns void (no promise) detaches synchronously — same
        // as an absent leave, but still routed through the pending record so a
        // reentrant switch during the call can't double-finalize.
        this.finalizeLeave(pending)
      }
      return
    }

    // Synchronous swap (no leave / immediate / SSR) — unchanged behavior.
    this.place.ownerHost.scope?.removeChild(m.scope)
    for (const t of m.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
    this.place.clear(m.nodes)
  }

  /** Detach a pending-leave arm and run its teardowns exactly once. */
  private finalizeLeave(pending: PendingLeave): void {
    if (pending.finalized) return
    pending.finalized = true
    this.pendingLeaves?.delete(pending)
    this.place.ownerHost.scope?.removeChild(pending.scope)
    for (const t of pending.teardowns.splice(0)) t()
    this.place.detach!(pending.nodes)
  }

  /** Finalize every in-flight leave synchronously (interruption / dispose). */
  private finalizePendingLeaves(): void {
    if (!this.pendingLeaves || this.pendingLeaves.size === 0) return
    for (const pending of [...this.pendingLeaves]) this.finalizeLeave(pending)
  }
}
