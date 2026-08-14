import { onTeardown, __currentBuildInfo } from '@llui/dom'

/**
 * Run `fn` when the enclosing build's scope tears down — but only if there is a
 * build to hook.
 *
 * `connect()` in this package is a pure part-bag builder: it must stay callable
 * from a unit test with no build context, so a bare `onTeardown` (which throws
 * outside a build) cannot be used directly. `__currentBuildInfo()` returns
 * `null` outside a build, giving a non-throwing predicate.
 *
 * Best-effort by design. Outside a build this is a no-op, so anything registered
 * here must be a CLEANUP for something that is already safe on its own — a
 * pending hover timer whose message is dropped by a detached-element guard, say.
 * Cancelling it is the tidy-up; the guard is the correctness.
 */
export function onScopeTeardown(fn: () => void): void {
  if (__currentBuildInfo() === null) return
  onTeardown(fn)
}
