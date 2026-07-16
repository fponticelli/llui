import type { Deps, InternalSend, Runner } from '../core.js'
import type { SequenceEffect } from '../types.js'

function runSequence(
  effect: SequenceEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
  onComplete: () => void,
): void {
  const effects = effect.effects.slice()

  function next(): void {
    if (signal.aborted) return
    if (effects.length === 0) {
      // Every step completed — signal completion to a wrapping sequence (if any).
      onComplete()
      return
    }
    const current = effects.shift()!

    // The sequence advances strictly on COMPLETION, never on a bubbled message.
    // Messages flow straight through `send`; `stepComplete` is the explicit
    // completion signal `dispatch` fires for this step — for a leaf step that is
    // its first dispatched message (or synchronously if it dispatches none), and
    // for a NESTED sequence it is that inner sequence's OWN last step completing.
    // So an outer sequence can never fast-forward past a still running inner one.
    let advanced = false
    const stepComplete = (): void => {
      if (advanced || signal.aborted) return
      advanced = true
      next()
    }

    deps.dispatch(current, send, signal, deps, stepComplete)
  }

  next()
}

export const sequenceRunner: Runner = {
  types: ['sequence'],
  completesWithoutDispatch: false,
  managesCompletion: true,
  run(effect, send, signal, deps, onComplete) {
    runSequence(effect as SequenceEffect, send, signal, deps, onComplete ?? (() => {}))
  },
}
