// Test helpers for the signal-handle connect() API.
//
// A migrated slice's `connect(state: Signal<State>, send)` returns prop bags
// whose reactive values are Signal HANDLES (state.map(...)). To exercise a prop
// against a given state in a unit test, pass `rootSignal()` to connect() and read
// a prop with `read(prop, stateValue)`.

import { pathHandle, isSignalHandle, type Signal } from '@llui/dom'

/** A root signal placeholder: `rootSignal<S>().map(fn).produce(s) === fn(s)`, so a
 * connect() built over it yields props readable against any state via `read`. */
export const rootSignal = <S>(): Signal<S> => pathHandle<S>(() => undefined, '')

/** Evaluate a connect() prop (a Signal handle) against a concrete state value. */
export function read<T>(prop: Signal<T> | T, state: unknown): T {
  return isSignalHandle(prop) ? (prop.produce(state) as T) : (prop as T)
}
