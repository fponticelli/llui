// The NON-NULL VIEW of a signal — what `show(cond, render)` hands its arm.
//
// Why a per-kind member rather than a cast inside `show`: `show` must give a path
// condition's arm a path signal (sliceable with `.at()`) and a mapped condition's
// arm a mapped one, typed non-nullable. An overloaded `show` cannot do that without
// an assertion — TypeScript erases an overloaded function's type parameters when
// it checks the overloads against the implementation, so the implementation never
// learns which overload was selected, and no runtime discriminant on the handle
// can recover it (a `ReadSignal` parameter may carry either kind at runtime). So
// the correlation lives on the signal types themselves: every kind declares
// `[NON_NULL_VIEW]()` returning ITS OWN kind over `NonNullable<T>`, each handle
// constructor implements it (and is type-checked against it), and `show` is one
// generic signature that passes the condition's view straight to the arm.
//
// The `NonNullable` half is not a type-level claim either: the view CHECKS it on
// every read (`nonNullRead`), because the framework cannot guarantee it. The arm
// only mounts while the condition is truthy, and its bindings stop before the
// condition's null reaches them, but a handler or callback can hold the view past
// that point — its own `send()` closes the arm synchronously, a timer fires after
// unmount. Such a read now fails loudly, naming the fix, instead of returning a
// value the type says cannot exist.
//
// `Symbol.for` for the same reason as the handle brand: the key must match across
// two physical copies of the module (a documented packaging bug, but not one that
// should turn into "not a function" at a signal read).

import { LluiFrameworkError } from './framework-error.js'

/** The key of a signal's non-null view (see this module's header). Internal to the
 * framework — not re-exported from the package root. */
export const NON_NULL_VIEW: unique symbol = Symbol.for('llui.signal.nonNullView')

/** Describes a condition for {@link nonNullRead}'s message. */
export type ConditionDescription = string

/** How {@link nonNullRead} names a path condition (`''` is the whole state). */
export function pathCondition(path: string): ConditionDescription {
  return `the condition at '${path === '' ? '(whole state)' : path}'`
}

/** How {@link nonNullRead} names a condition with no state path. */
export const MAPPED_CONDITION: ConditionDescription = 'a mapped condition'
/** How {@link nonNullRead} names a `constant(…)` condition. */
export const CONSTANT_CONDITION: ConditionDescription = 'a constant condition'

/** Return `value`, proven non-nullable by the check itself, or throw the branded
 * error explaining why a narrowed signal was read while its condition is cleared. */
export function nonNullRead<V>(value: V, where: ConditionDescription): NonNullable<V> {
  if (value === null || value === undefined) {
    throw new LluiFrameworkError(
      `show(): the signal an arm received was read while ${where} is ${value === null ? 'null' : 'undefined'}. ` +
        `An arm's signal is typed non-nullable because it only exists while its condition holds — but a handler, ` +
        `timer or effect can outlive that (for example a click handler whose own send() closed the arm). ` +
        `Read what may have cleared from the CONDITION signal instead and handle null there: cond.peek()?.field, ` +
        `not narrowed.peek().field.`,
    )
  }
  return value
}
