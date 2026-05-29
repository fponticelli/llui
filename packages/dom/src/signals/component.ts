// Signal component lifecycle — the TEA loop for signal-compiled components.
//
// State is plain data; `view` builds DOM once via the signal helpers; `send`
// runs the pure reducer, feeds the new state to the chunked-mask reconciler
// (which re-runs only bindings whose dependency paths changed), then dispatches
// returned effects to `onEffect`.
//
// The view bag carries a `state` HANDLE — `.peek()` / `.at(path).peek()` read the
// CURRENT state. Reactive slots are compiled to bindings that don't touch this
// handle; only event handlers / effects use it (the `state.at('x').peek()` form
// is left verbatim by the transform and satisfied here at runtime).

import { mountSignal, type SignalMount } from './dom.js'
import { resolvePath } from './mask.js'
import type { Signal } from './types.js'

/** The bag's `state` is a `Signal<S>` so authored handler code reads it the same
 * way as the view (`state.at('x').peek()`). At runtime it's a read handle: `.at`
 * narrows, `.peek` reads the current value; `.map` is a view-build-time concept
 * and throws if reached on the handle. */
export type StateHandle<S> = Signal<S>

function makeHandle<S>(get: () => unknown, base = ''): Signal<S> {
  // The runtime realization of the Signal read-surface for handlers/effects.
  return {
    peek: () => resolvePath(get(), base) as S,
    at: (path: string) => makeHandle(get, base === '' ? path : `${base}.${path}`),
    map: () => {
      throw new Error('.map() is a view-build-time signal op; use .peek() in handlers/effects')
    },
  } as Signal<S>
}

export interface ComponentBag<S, M> {
  state: Signal<S>
  send: (msg: M) => void
}

export interface EffectApi<S, M> {
  send: (msg: M) => void
  state: Signal<S>
}

export interface SignalComponentDef<S, M, E = never> {
  /** initial state, optionally with initial effects */
  init: () => S | [S, E[]]
  /** pure reducer; returns the next state, optionally with effects. A bare `S`
   * (non-tuple) return is accepted for convenience. */
  update: (state: S, msg: M) => [S, E[]] | S
  /** build the view once; reactive reads are signal bindings (they don't close
   * over `state`). The bag's `state` handle is for handlers/effects. */
  view: (bag: ComponentBag<S, M>) => readonly Node[]
  /** handle an effect; may return a cleanup function */
  onEffect?: (effect: E, api: EffectApi<S, M>) => void | (() => void)
}

export interface SignalComponentHandle<S, M> {
  send(msg: M): void
  getState(): S
  /** run all pending effect cleanups (subscriptions etc.) */
  dispose(): void
}

function normalize<S, E>(r: [S, E[]] | S): [S, E[]] {
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [S, E[]])[1])) {
    return r as [S, E[]]
  }
  return [r as S, []]
}

/** Mount a signal component into `container` and drive its update loop. */
export function mountSignalComponent<S, M, E = never>(
  container: Element,
  def: SignalComponentDef<S, M, E>,
): SignalComponentHandle<S, M> {
  const [initialState, initialEffects] = normalize<S, E>(def.init())
  let state = initialState
  let mount: SignalMount | null = null
  const cleanups: Array<() => void> = []

  const handle = makeHandle<S>(() => state)

  const runEffect = (effect: E): void => {
    const cleanup = def.onEffect?.(effect, { send, state: handle })
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }

  function send(msg: M): void {
    const [next, effects] = normalize<S, E>(def.update(state, msg))
    if (!Object.is(next, state)) {
      state = next
      mount?.update(next)
    }
    for (const e of effects) runEffect(e)
  }

  mount = mountSignal(container, state, () => def.view({ state: handle, send }))
  for (const e of initialEffects) runEffect(e)

  return {
    send,
    getState: () => state,
    dispose: () => {
      mount?.dispose() // foreign unmounts, subscriptions
      for (const c of cleanups.splice(0)) c()
    },
  }
}
