/**
 * Dev-only effect interceptor hook — consumed by `@llui/mcp` (via
 * `@llui/dom`'s devtools wiring) to implement effect mocking.
 *
 * Contract:
 * - Default state is `null` — zero overhead when no interceptor is set.
 * - Calling `_setEffectInterceptor(null)` clears the hook.
 * - The hook receives the raw effect object and an opaque dispatch ID;
 *   it returns either `{ mocked: true, response }` to short-circuit the
 *   real effect dispatch, or `{ mocked: false }` to pass through.
 *
 * Phase 1 consumers rely on the pass-through path; the short-circuit
 * path is exercised end-to-end through `@llui/dom`'s effect-dispatch
 * wrapper. This module only owns the null-safe set/get contract.
 */

export type EffectInterceptorResult = { mocked: true; response: unknown } | { mocked: false }

export type EffectInterceptor = ((effect: unknown, id: string) => EffectInterceptorResult) | null

let interceptor: EffectInterceptor = null

/**
 * Dev-only hook reserved for Phase 2 use. No-op in production — setting
 * this is a developer opt-in. When `null`, callers skip the check entirely
 * so there is zero allocation on the hot path.
 *
 * Phase 1 reality: `@llui/dom`'s dev effect-dispatch wrapper
 * (`dispatchEffectDev`) catches every update-loop effect upstream, so
 * Phase 1 callers of this hook will NOT observe invocations. Third-party
 * effect libraries must not rely on this hook being called during Phase 1.
 *
 * Phase 2 wires this for off-loop dispatches (e.g., effects dispatched
 * from Web Workers or post-mount lifecycle hooks) where `@llui/dom`'s
 * wrapper doesn't reach.
 */
export function _setEffectInterceptor(hook: EffectInterceptor): void {
  interceptor = hook
}

/** @internal consumed by `@llui/dom`'s effect-dispatch wrapper. */
export function _getEffectInterceptor(): EffectInterceptor {
  return interceptor
}
