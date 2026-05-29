// Signal component lifecycle — the TEA loop for signal-compiled components.
//
// Ties together plain-data init/update with the signal DOM layer: state lives as
// plain data; `view` builds DOM once via the signal helpers; `send` runs the
// pure update and feeds the new state to the chunked-mask reconciler, which
// re-runs only the bindings whose dependency paths changed.
//
// Minimal first cut: synchronous update, no effects yet (effects-as-data +
// onEffect, send() microtask batching, and structural primitives layer on top).
// Built alongside the legacy component() runtime (per-file-flip migration).

import { mountSignal, type SignalMount } from './dom.js'

export interface SignalComponentDef<S, M> {
  /** initial plain-data state */
  init: () => S
  /** pure reducer: returns the next state (no effects in this first cut) */
  update: (state: S, msg: M) => S
  /** build the view once; receives `send`. Reactive reads are signal bindings
   * created by the signal DOM helpers — they do not close over `state`. */
  view: (send: (msg: M) => void) => readonly Node[]
}

export interface SignalComponentHandle<S, M> {
  send(msg: M): void
  getState(): S
}

/** Mount a signal component into `container` and drive its update loop. */
export function mountSignalComponent<S, M>(
  container: Element,
  def: SignalComponentDef<S, M>,
): SignalComponentHandle<S, M> {
  let state = def.init()
  let mount: SignalMount | null = null

  const send = (msg: M): void => {
    const next = def.update(state, msg)
    if (Object.is(next, state)) return // no change — nothing to reconcile
    state = next
    mount?.update(next)
  }

  mount = mountSignal(container, state, () => def.view(send))

  return {
    send,
    getState: () => state,
  }
}
