import type { Deps, InternalSend, Runner } from '../core.js'
import type { SequenceEffect } from '../types.js'

function runSequence(
  effect: SequenceEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): void {
  const effects = effect.effects.slice()

  function next(): void {
    if (signal.aborted || effects.length === 0) return
    const current = effects.shift()!

    // A step advances the sequence exactly once — on its first emitted message
    // (the common terminal-message case, e.g. http's onSuccess/onError). A step
    // that emits several messages (interval ticks, upload progress) advances on
    // the first and must NOT fast-forward the remaining steps. A step that emits
    // NO message advances synchronously, driven by the `completesWithoutDispatch`
    // signal returned from `dispatch` (rather than a hardcoded name-set) —
    // bare `cancel`, `clipboard-write`, `log`, `storage-set`/`-remove`,
    // `broadcast`, and `ws-send` all report this. A step that SUBSCRIBES
    // (interval, websocket, storage-watch, broadcast-listen) advances on its
    // first dispatched message, so a subscription mid-sequence gates the rest of
    // the chain on its first event.
    let advanced = false
    const advance = (): void => {
      if (advanced || signal.aborted) return
      advanced = true
      next()
    }

    const wrappedSend: InternalSend = (msg) => {
      send(msg)
      advance()
    }

    const completesWithoutDispatch = deps.dispatch(current, wrappedSend, signal, deps)
    if (completesWithoutDispatch) advance()
  }

  next()
}

export const sequenceRunner: Runner = {
  types: ['sequence'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runSequence(effect as SequenceEffect, send, signal, deps)
  },
}
