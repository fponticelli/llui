// Conditional (`show`) and discriminated-union (`branch`) rendering — both are the
// same one-mounted-arm machine ({@link ArmController}) differing only in arm-key
// type (`boolean` vs `string`) and how the key + arm builder are derived from the
// reconcile state.

import { requireCtx, mountable, type Mountable } from './build-context.js'
import type { Renderable } from './element.js'
import { isRowLocalDep, rebaseComponentDep, rebaseRowDep } from './row-rebase.js'
import { removeBetween } from './dom-region.js'
import { ArmController } from './arm-controller.js'

/** Condition source for `signalShow` / discriminant source for `signalBranch`: an
 * accessor plus its dep paths. */
export interface ShowCond {
  produce: (state: unknown) => unknown
  deps: readonly string[]
  /** See {@link BindingSpec.componentRooted}: `true` when the condition reads the
   * COMPONENT state (so inside a row it's fed `ctx.state`, not the combined ctx).
   * Set by the authoring layer from the cond handle; unbranded → string inference. */
  componentRooted?: boolean
}

/** Root a condition/discriminant per its deps (mirroring `rebaseRowSpec`): all-row-local
 * (a compiled row's `ctx.item`/`ctx.state`, or an item/index handle) is evaluated
 * against the FULL combined ctx; a non-row-local enclosing-view handle (rooted at the
 * bare component state) is fed `ctx.state`. Uses the `componentRooted` brand
 * (collision-proof) with string inference as the unbranded fallback. */
function isCondComponentRooted(cond: ShowCond): boolean {
  return cond.componentRooted === true
    ? true
    : cond.componentRooted === false
      ? false
      : !cond.deps.every(isRowLocalDep)
}

/** Deps for the structural binding: at top level the cond's own deps; inside a row,
 * rebased onto the combined ctx so gating fires on `ctx.state` changes. */
function structuralDeps(
  cond: ShowCond,
  inRow: boolean,
  componentRooted: boolean,
): readonly string[] {
  return inRow ? cond.deps.map(componentRooted ? rebaseComponentDep : rebaseRowDep) : cond.deps
}

/**
 * Conditional render. Mounts `render`'s content when the condition is truthy; if
 * an `orElse` arm is given, mounts it when falsy (otherwise nothing). The mounted
 * arm is its OWN scope that reads the owning component's state, registered as a
 * child of the owning scope — so while mounted it receives state updates (its
 * bindings re-run when THEIR deps change, not just when the condition flips).
 * Toggling the condition swaps arms; a same-truthiness update does NOT remount.
 */
export function signalShow(
  cond: ShowCond,
  render: () => Renderable,
  orElse?: () => Renderable,
): Mountable {
  return mountable(() => buildSignalShow(cond, render, orElse))
}

function buildSignalShow(
  cond: ShowCond,
  render: () => Renderable,
  orElse?: () => Renderable,
): Node {
  const c = requireCtx()
  const doc = c.doc
  const inRow = c.inRow
  // Inside an each row the scope state is the combined ctx `{ item, state }`. The
  // arm is child-propagated that full ctx, so it must MOUNT on it (not on the
  // component state); the arm's value specs are rebased to read `ctx.state`.
  //
  // The CONDITION is rooted per its deps (see `isCondComponentRooted`): a cond whose
  // deps are all row-local is evaluated against the FULL combined ctx; a cond with a
  // non-row-local dep is an enclosing-view handle rooted at the bare component state,
  // so it is fed `ctx.state`. (A mixed `derived([state, item], …)` cond is rebased
  // per-input in the authoring layer so its deps are all row-local by the time it
  // reaches here.)
  const condIsComponentRooted = isCondComponentRooted(cond)
  const condReadsCtx = !inRow || !condIsComponentRooted
  const evalCond = (s: unknown): unknown =>
    cond.produce(condReadsCtx ? s : (s as { state: unknown }).state)
  const start = doc.createComment('show')
  const end = doc.createComment('/show')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  const arm = new ArmController<boolean>({
    doc,
    buildCtx: c,
    ownerHost: c.host,
    inRow,
    parent: () => end.parentNode,
    insertBefore: () => end,
    clear: () => removeBetween(start, end), // arm nodes + any nested-structural content
  })

  const reconcile = (state: unknown): void => {
    const on = Boolean(evalCond(state))
    arm.switchTo(on, on ? render : orElse, state)
  }

  // Gated by the condition's deps (reconcile only when the condition may change);
  // produce returns the full state so reconcile can mount the arm against it. In a
  // row, the deps are rebased onto the combined ctx so gating fires on `ctx.state`
  // changes; `structural: true` keeps the enclosing each from rewriting `produce`.
  c.specs.push({
    deps: structuralDeps(cond, inRow, condIsComponentRooted),
    produce: (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose, tear down the currently-mounted arm (onMount cleanups,
  // foreign unmounts) — otherwise reference-counted side effects (scroll lock,
  // focus trap, dismissable) leak when the component unmounts while open. Also
  // remove the arm's nodes (incl. nested-structural content) so that disposing an
  // OUTER arm — which runs this teardown for an inner show/branch — clears the
  // inner content rather than orphaning it between the (now-removed) anchors.
  c.teardowns.push(() => arm.dispose())

  return frag
}

/**
 * Discriminated-union render. Mounts the arm matching the discriminant's current
 * value; swaps arms when it changes (the old arm unmounts, the new one mounts as
 * a child scope). Same-value updates do NOT remount — the mounted arm's child
 * scope handles its own inner reactivity. An absent arm renders nothing.
 */
export function signalBranch(
  disc: ShowCond,
  arms: Readonly<Record<string, () => Renderable>>,
): Mountable {
  return mountable(() => buildSignalBranch(disc, arms))
}

function buildSignalBranch(disc: ShowCond, arms: Readonly<Record<string, () => Renderable>>): Node {
  const c = requireCtx()
  const doc = c.doc
  const inRow = c.inRow
  // See signalShow: in an each row the arm mounts on the full combined ctx and its
  // value specs are rebased to read `ctx.state`. The discriminant is rooted per its
  // deps — all-row-local reads the full ctx; a non-row-local enclosing-view handle
  // reads `ctx.state`.
  const discIsComponentRooted = isCondComponentRooted(disc)
  const discReadsCtx = !inRow || !discIsComponentRooted
  const evalDisc = (s: unknown): unknown =>
    disc.produce(discReadsCtx ? s : (s as { state: unknown }).state)
  const start = doc.createComment('branch')
  const end = doc.createComment('/branch')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  const arm = new ArmController<string>({
    doc,
    buildCtx: c,
    ownerHost: c.host,
    inRow,
    parent: () => end.parentNode,
    insertBefore: () => end,
    clear: () => removeBetween(start, end),
  })

  const reconcile = (state: unknown): void => {
    const key = String(evalDisc(state))
    arm.switchTo(key, arms[key], state)
  }

  c.specs.push({
    deps: structuralDeps(disc, inRow, discIsComponentRooted),
    produce: (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose, tear down the mounted arm (see signalShow for rationale).
  c.teardowns.push(() => arm.dispose())

  return frag
}
