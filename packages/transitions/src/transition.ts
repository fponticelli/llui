import type { TransitionOptions } from '@llui/dom'
import type { TransitionSpec } from './types.js'
import { applyValue, removeValue, asElements, detectDuration, forceReflow } from './style-utils.js'
import { waitForEnd, createRunScope } from './anim.js'

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
 * and a superseded phase's delayed cleanup is skipped.
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

  const runEnter = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

    // Roll back any in-flight run, then claim a new one per element.
    for (const el of els) runs.supersede(el)
    const tokens = els.map((el) =>
      runs.register(el, () => {
        removeValue(el, spec.enterFrom)
        removeValue(el, spec.enterActive)
        removeValue(el, spec.enterTo)
      }),
    )

    // Apply from + active
    for (const el of els) {
      applyValue(el, spec.enterFrom)
      applyValue(el, spec.enterActive)
    }

    // Force reflow so the next value change triggers a transition.
    forceReflow(els[0]!)

    // Move to target state
    for (const el of els) {
      removeValue(el, spec.enterFrom)
      applyValue(el, spec.enterTo)
    }

    const duration = spec.duration ?? detectDuration(els[0]!)

    return Promise.all(
      els.map((el, i) =>
        waitForEnd(el, duration).then(() => {
          // Superseded by a newer run — leave cleanup to that run.
          if (!runs.isCurrent(el, tokens[i]!)) return
          removeValue(el, spec.enterActive)
          removeValue(el, spec.enterTo)
          runs.end(el, tokens[i]!)
        }),
      ),
    ).then(() => undefined)
  }

  const runLeave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

    for (const el of els) runs.supersede(el)
    const tokens = els.map((el) =>
      runs.register(el, () => {
        removeValue(el, spec.leaveFrom)
        removeValue(el, spec.leaveActive)
        removeValue(el, spec.leaveTo)
      }),
    )

    for (const el of els) {
      applyValue(el, spec.leaveFrom)
      applyValue(el, spec.leaveActive)
    }

    forceReflow(els[0]!)

    for (const el of els) {
      removeValue(el, spec.leaveFrom)
      applyValue(el, spec.leaveTo)
    }

    const duration = spec.duration ?? detectDuration(els[0]!)
    return Promise.all(
      els.map((el, i) =>
        waitForEnd(el, duration).then(() => {
          // Leave completed — the element is about to be removed by the
          // runtime, so we don't strip its resting values, just release the
          // run token (if still ours).
          runs.end(el, tokens[i]!)
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
