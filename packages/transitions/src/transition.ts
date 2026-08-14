import type { TransitionOptions } from '@llui/dom'
import type { TransitionSpec } from './types.js'
import {
  applyValue,
  removeValue,
  asElements,
  detectDuration,
  forceReflow,
  styleKeysOf,
  snapshotInline,
  restoreInline,
  removeClassesOnly,
  animatedProperties,
  computedValues,
} from './style-utils.js'
import { waitForEnd, createRunScope, prefersReducedMotion } from './anim.js'

/**
 * Build a `TransitionOptions` bundle (`{ enter, leave }`) from a class/style spec.
 *
 * The returned hooks operate on raw DOM `Node`s and are invoked by two seams:
 *
 *  - **Element-level structural transitions** — the signal `show`/`branch`/`each`
 *    primitives accept this `TransitionOptions` bundle directly and drive it:
 *    `enter` animates a freshly-mounted arm/row in, and `leave` DEFERS the
 *    swapped-out arm/row's unmount until its promise resolves. Pass a bundle as
 *    the trailing argument:
 *
 *    ```ts
 *    show(state.at('open'), () => [panel()], undefined, fade({ duration: 150 }))
 *    branch(state, s => s.tab, { a: () => [tabA()], b: () => [tabB()] }, slide())
 *    each(state.at('items'), i => i.id, row, undefined, fade({ duration: 120 }))
 *    ```
 *
 *  - **Route/container** seam — `fromTransition(...)` in `@llui/vike/client`
 *    adapts the same bundle onto the page slot element (see `routeTransition`)
 *    for whole-view/route navigations rather than individual arms.
 *
 * Lifecycle:
 *  - **enter**: apply `enterFrom` + `enterActive` → reflow → swap `enterFrom` → `enterTo`
 *    → wait for `transitionend` (timer fallback) → remove all transient values.
 *  - **leave**: apply `leaveFrom` + `leaveActive` → reflow → swap `leaveFrom` → `leaveTo`
 *    → resolve on `transitionend` (timer fallback) so DOM removal is deferred.
 *
 * Interruption: enter/leave on a reused element are guarded by a per-element run
 * token — a new phase first rolls back the previous phase's transient values,
 * and a superseded phase's delayed cleanup is skipped. This holds for a leave
 * that already COMPLETED too: it keeps its resting values (the arm is about to
 * be detached) but stays registered, so if the element is instead reused — the
 * route seam calls `enter` on the very element it just left — the enter clears
 * that residue before snapshotting its own baseline.
 *
 * Interrupting a phase mid-flight resumes from the element's CURRENT rendered
 * values in BOTH directions, by the same mechanism: the animated properties are
 * frozen at what the element is showing and applied in place of the phase's
 * `from` value, so neither direction re-animates from the far end. Freezing is
 * what makes it work — merely SKIPPING the `from` value is not enough, because
 * superseding the interrupted phase fires its rollback, which restores the
 * pre-phase inline value (for a fade, `''` — fully visible). A phase that has
 * already settled counts as resting, not as an interrupt.
 *
 * Completion: a phase resolves only once EVERY property it animates (the style
 * keys of its `from`/`to` values) has reported a `transitionend` on the element
 * itself — an unrelated `transitionend` (a hover `background-color`, or the fast
 * half of `transition: opacity 100ms, transform 500ms`) does not end the phase,
 * because the runtime detaches a leaving node on exactly that promise. A
 * class-only spec names no properties, so any end on the target resolves it.
 *
 * Duration (used only for the fallback timer / when no CSS transition fires):
 *  - If `duration` is given, it is used verbatim.
 *  - Otherwise, computed `transition-duration + transition-delay` is read after
 *    the active/from values are applied, taking the max across properties.
 */
export function transition(spec: TransitionSpec): TransitionOptions {
  const appear = spec.appear !== false
  // One scope per bundle: enter↔leave interrupt each other, but this bundle
  // never clobbers a sibling bundle merged onto the same element.
  const runs = createRunScope()

  // The properties each phase animates between, so a `transitionend` for some
  // unrelated property on the same element can't resolve the wait early and let
  // the runtime detach the node mid-animation (#105). Computed once per bundle.
  const enterProperties = animatedProperties(spec.enterFrom, spec.enterTo)
  const leaveProperties = animatedProperties(spec.leaveFrom, spec.leaveTo)

  const reducedMotion = (): boolean => spec.respectReducedMotion !== false && prefersReducedMotion()

  const runEnter = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

    // Reduced motion: skip the from-state entirely so the element simply appears
    // in its final (natural) resting state, and resolve at once.
    if (reducedMotion()) {
      for (const el of els) {
        runs.supersede(el)
        applyValue(el, spec.enterTo)
      }
      return Promise.resolve()
    }

    // An element with a run already in flight is a mid-animation leave being
    // REVERSED (an `each` row resurrected, the route seam re-entering the very
    // element it just left). Applying `enterFrom` there drives it to the far end
    // and re-animates from scratch, so for those elements we freeze the values
    // the element is actually showing and let the enter run from there.
    //
    // Both reads happen BEFORE `supersede`: `isActive` because superseding
    // clears the run, and the computed values because the rollback restores the
    // pre-leave inline styles — for a property the author never set inline, that
    // IS the far end.
    const interrupting = els.map((el) => runs.isActive(el))
    const resume = els.map((el, i) =>
      interrupting[i] ? computedValues(el, enterProperties) : undefined,
    )

    // Roll back any in-flight run, then claim a new one per element. Cleanup
    // RESTORES each touched inline style to its pre-transition value (rather than
    // blanking it), so an element with an author-set inline `opacity`/`transform`
    // keeps it after the transition. Class portions are simply removed.
    for (const el of els) runs.supersede(el)
    const cleanups = els.map((el) => {
      const keys = [
        ...styleKeysOf(spec.enterFrom),
        ...styleKeysOf(spec.enterActive),
        ...styleKeysOf(spec.enterTo),
      ]
      const snapshot = snapshotInline(el, keys)
      return () => {
        restoreInline(el, snapshot)
        removeClassesOnly(el, spec.enterFrom)
        removeClassesOnly(el, spec.enterActive)
        removeClassesOnly(el, spec.enterTo)
      }
    })
    const tokens = els.map((el, i) => runs.register(el, cleanups[i]!))

    // Apply from + active — or, when interrupting, the frozen current values in
    // place of `enterFrom`.
    els.forEach((el, i) => {
      applyValue(el, resume[i] ?? spec.enterFrom)
      applyValue(el, spec.enterActive)
    })

    // Force reflow so the next value change triggers a transition.
    forceReflow(els[0]!)

    // Move to target state. An interrupting element never had `enterFrom`
    // applied, so there is nothing to remove — and removing it would strip the
    // frozen value the transition is meant to start from.
    els.forEach((el, i) => {
      if (!interrupting[i]) removeValue(el, spec.enterFrom)
      applyValue(el, spec.enterTo)
    })

    const duration = spec.duration ?? detectDuration(els[0]!)

    return Promise.all(
      els.map((el, i) =>
        waitForEnd(el, duration, enterProperties).then(() => {
          // Superseded by a newer run — leave cleanup to that run.
          if (!runs.isCurrent(el, tokens[i]!)) return
          cleanups[i]!()
          runs.end(el, tokens[i]!)
        }),
      ),
    ).then(() => undefined)
  }

  const runLeave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

    // Reduced motion: resolve immediately so the runtime removes the element now,
    // with no leave animation.
    if (reducedMotion()) {
      for (const el of els) runs.supersede(el)
      return Promise.resolve()
    }

    // An element with a run already in flight is a mid-animation enter being
    // interrupted. Applying `leaveFrom` there would snap it to the fully-shown
    // resting state before animating out (the "snaps to fully-visible" bug), so
    // for those elements we freeze the values the element is actually showing
    // and let the leave run out from there. A fresh (resting) element keeps the
    // normal `leaveFrom` → `leaveTo` swap.
    //
    // The mirror image of the enter path, and for the same reason: SKIPPING
    // `leaveFrom` is not on its own enough, because `supersede` below fires the
    // interrupted enter's rollback, which `restoreInline`s the PRE-ENTER inline
    // value — for a fade that is `''`, i.e. fully visible. So both reads happen
    // BEFORE `supersede`: `isActive` because superseding clears the run, and the
    // computed values because the rollback erases them.
    const interrupting = els.map((el) => runs.isActive(el))
    const resume = els.map((el, i) =>
      interrupting[i] ? computedValues(el, leaveProperties) : undefined,
    )

    // Rollback (only fired if a newer run supersedes this leave before it ends,
    // e.g. an enter re-shows the element) restores the pre-transition inline
    // styles rather than blanking them.
    for (const el of els) runs.supersede(el)
    const tokens = els.map((el) => {
      const keys = [
        ...styleKeysOf(spec.leaveFrom),
        ...styleKeysOf(spec.leaveActive),
        ...styleKeysOf(spec.leaveTo),
      ]
      const snapshot = snapshotInline(el, keys)
      return runs.register(el, () => {
        restoreInline(el, snapshot)
        removeClassesOnly(el, spec.leaveFrom)
        removeClassesOnly(el, spec.leaveActive)
        removeClassesOnly(el, spec.leaveTo)
      })
    })

    // Apply from + active — or, when interrupting, the frozen current values in
    // place of `leaveFrom`.
    els.forEach((el, i) => {
      applyValue(el, resume[i] ?? spec.leaveFrom)
      applyValue(el, spec.leaveActive)
    })

    forceReflow(els[0]!)

    // An interrupting element never had `leaveFrom` applied, so there is nothing
    // to remove — and removing it would strip the frozen value the transition is
    // meant to start from, since both write the same property keys.
    els.forEach((el, i) => {
      if (!interrupting[i]) removeValue(el, spec.leaveFrom)
      applyValue(el, spec.leaveTo)
    })

    const duration = spec.duration ?? detectDuration(els[0]!)
    return Promise.all(
      els.map((el, i) =>
        waitForEnd(el, duration, leaveProperties).then(() => {
          // Leave completed. We don't strip its resting values: under
          // show/branch/each the element is about to be removed, and blanking
          // `opacity: 0` here would flash the outgoing content back for a frame.
          // But we SETTLE rather than `end` the run, so its rollback stays
          // registered — at the route seam (`fromTransition`) the very same
          // element is then handed to `enter`, whose `supersede` uses that
          // rollback to clear this residue BEFORE snapshotting. Without it the
          // enter snapshots `opacity: 0` as an author value and restores it on
          // cleanup, parking the page slot invisible. When the element really is
          // removed, the WeakMap entry goes with it and the rollback never runs.
          runs.settle(el, tokens[i]!)
        }),
      ),
    ).then(() => undefined)
  }

  const out: TransitionOptions = {
    leave: runLeave,
  }

  if (appear) {
    out.enter = (nodes: Node[]) => {
      void runEnter(nodes)
    }
  }

  return out
}
