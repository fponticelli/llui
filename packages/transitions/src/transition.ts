import type { TransitionOptions } from '@llui/dom'
import type { TransitionSpec } from './types'
import { applyValue, removeValue, asElements, detectDuration, forceReflow } from './style-utils'

// Buffer added to setTimeout so styles have settled before resolution.
const TIMING_BUFFER_MS = 16

/**
 * Build a `TransitionOptions` bundle ({ enter, leave }) from a spec.
 *
 * Pass the result into `branch`, `show`, or `each` to animate the enter/leave
 * of that structural block.
 *
 * Lifecycle:
 *  - **enter**: apply `enterFrom` + `enterActive` → reflow → swap `enterFrom` → `enterTo`
 *    → wait for duration → remove all transient values (element rests on its base styles).
 *  - **leave**: apply `leaveFrom` + `leaveActive` → reflow → swap `leaveFrom` → `leaveTo`
 *    → wait for duration (Promise-resolved so DOM removal is deferred).
 *
 * Duration:
 *  - If `duration` is given, it is used verbatim.
 *  - Otherwise, computed `transition-duration + transition-delay` is read after
 *    the active/from classes are applied, taking the max across properties.
 */
export function transition(spec: TransitionSpec): TransitionOptions {
  const appear = spec.appear !== false

  const runEnter = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

    // Apply from + active
    for (const el of els) {
      applyValue(el, spec.enterFrom)
      applyValue(el, spec.enterActive)
    }

    // Force reflow so the next class change triggers a transition.
    forceReflow(els[0]!)

    // Move to target state
    for (const el of els) {
      removeValue(el, spec.enterFrom)
      applyValue(el, spec.enterTo)
    }

    const duration = spec.duration ?? detectDuration(els[0]!)

    return wait(duration).then(() => {
      for (const el of els) {
        removeValue(el, spec.enterActive)
        removeValue(el, spec.enterTo)
      }
    })
  }

  const runLeave = (nodes: Node[]): Promise<void> => {
    const els = asElements(nodes)
    if (els.length === 0) return Promise.resolve()

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
    return wait(duration)
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

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms + TIMING_BUFFER_MS)
  })
}
