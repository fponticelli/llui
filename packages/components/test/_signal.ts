// Test helpers for the signal-handle connect() API.
//
// A migrated component's `connect(state: Signal<State>, send)` returns prop bags
// whose reactive values are Signal HANDLES (state.map(...)). To exercise a prop
// against a given state in a unit test, pass `rootSignal()` to connect() and read
// a prop with `read(prop, stateValue)`.

import { pathHandle, isSignalHandle, type Signal } from '@llui/dom'

/**
 * The value a valueless root signal reports from `peek()`. There is none: a
 * `rootSignal()` carries no live state, only the ability to `produce` against a
 * state handed in at read time. It used to be built as `pathHandle(() => undefined)`,
 * which made `peek()` return `undefined` while typed `S` — a lie that production
 * code then defended against (`state.peek()?.field`, `if (before && after)`),
 * shaping shipped source around a test double. Failing loudly instead keeps
 * `Signal.peek(): T` true of every handle a component can be handed.
 */
const noLiveValue = (): never => {
  throw new Error(
    'rootSignal() has no live value, so peek() is unavailable on it. Use signalOf(state) ' +
      'for a code path that peeks, or drive a real reducer through pathHandle(() => state, ...).',
  )
}

/** A root signal placeholder: `rootSignal<S>().map(fn).produce(s) === fn(s)`, so a
 * connect() built over it yields props readable against any state via `read`.
 * It has no live value — `peek()` throws; use {@link signalOf} when the code
 * under test peeks. */
export const rootSignal = <S>(): Signal<S> => pathHandle<S>(noLiveValue, '')

/** A signal backed by a concrete value: `signalOf(v).peek() === v`. For APIs that
 * read the value directly (e.g. toast `parts.toast(item)`), and for any connect()
 * whose handlers peek. */
export const signalOf = <S>(value: S): Signal<S> => pathHandle<S>(() => value, '')

/** Evaluate a connect() prop (a Signal handle) against a concrete state value. */
export function read<T>(prop: Signal<T> | T, state: unknown): T {
  return isSignalHandle(prop) ? (prop.produce(state) as T) : (prop as T)
}
