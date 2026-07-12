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
}

interface MountedArm<K> {
  key: K
  scope: SignalScope
  nodes: readonly Node[]
  teardowns: Array<() => void>
}

/**
 * Holds at most one mounted arm keyed by `K`. `switchTo` swaps to the arm for a new
 * key (or unmounts when `armFn` is undefined / a same-key call short-circuits);
 * `dispose` tears the current arm down. Behavior matches the former inline
 * show/branch reconcile + host-dispose teardown exactly.
 */
export class ArmController<K> {
  private mounted: MountedArm<K> | null = null

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

    this.teardown()

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
  }

  /** Tear down the currently-mounted arm, if any (host dispose). Idempotent. */
  dispose(): void {
    this.teardown()
  }

  private teardown(): void {
    if (!this.mounted) return
    this.place.ownerHost.scope?.removeChild(this.mounted.scope)
    for (const t of this.mounted.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
    this.place.clear(this.mounted.nodes)
    this.mounted = null
  }
}
