// Test helpers for the signal-handle connect() API.
//
// A migrated slice's `connect(state: ReadSignal<State>, send)` returns prop bags
// whose reactive values are signal HANDLES (state.map(...)). To exercise a prop
// against a given state in a unit test, pass `rootSignal()` to connect() and read
// a prop with `read(prop, stateValue)`.

import { pathHandle, isSignalHandle, type ReadSignal, type Signal } from '@llui/dom'

/** A root signal placeholder: `rootSignal<S>().map(fn).produce(s) === fn(s)`, so a
 * connect() built over it yields props readable against any state via `read`. */
export const rootSignal = <S>(): Signal<S> => pathHandle<S>(() => undefined, '')

/** Evaluate a connect() prop (a signal handle of either kind) against a concrete
 * state value. */
export function read<T>(prop: ReadSignal<T> | T, state: unknown): T {
  return isSignalHandle(prop) ? (prop.produce(state) as T) : (prop as T)
}
