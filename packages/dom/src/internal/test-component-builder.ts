// Internal — `defineTestComponent` builder shared by @llui/dom's own tests
// and `@llui/test`. v2b §6.3.
//
// At v2b ship, the runtime's `createInstance` rejects components without
// `__compilerVersion`. Tests that mount raw `ComponentDef` literals would
// flood the warn channel and break warn-count assertions. This builder
// produces a `ComponentDef` carrying the `'__test__'` sentinel version
// plus an identity `__prefixes` table — enough for the runtime to treat
// it as compiled.
//
// Why "shared private internal":
//   - `@llui/dom`'s own test/ suite needs this; the test/ folder can't
//     import from `@llui/test` (which depends on @llui/dom).
//   - `@llui/test`'s consumers need the same builder to opt into the
//     optimized path.
// The single source of truth lives here; both packages re-export
// through their own helper modules so consumers never reach into
// @llui/dom's internal/ namespace directly.
//
// Tree-shaking: the file is reachable only from test/ folders, which
// production bundles don't include. A `sideEffects: false` package +
// the import-graph-rooted-in-test-helpers shape guarantees zero bytes
// in `dist/`. See packages/dom/package.json `sideEffects` and the
// bundle-size fixture in v2b §6 (deferred to a follow-up).

import type { ComponentDef } from '../types.js'

export interface DefineTestComponentInput<S, M, E = never, D = void> {
  name: string
  init: (data: D) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: ComponentDef<S, M, E, D>['view']
  onEffect?: ComponentDef<S, M, E, D>['onEffect']
}

/**
 * Build a `ComponentDef` opted into the optimized runtime path. Carries
 * the `'__test__'` sentinel `__compilerVersion` so `createInstance` skips
 * the version gate. Bare-minimum — no `__update`, no `__handlers`, no
 * `__prefixes` — meaning the runtime correctly routes to `genericUpdate`
 * with FULL_MASK on every update.
 *
 * Tests that want to exercise the compiler's fast path explicitly should
 * still construct raw `ComponentDef`s with the synthesized fields (and
 * the v2c compiler-tests harness will cover those scenarios end-to-end).
 */
export function defineTestComponentInternal<S, M, E = never, D = void>(
  input: DefineTestComponentInput<S, M, E, D>,
): ComponentDef<S, M, E, D> {
  const out: ComponentDef<S, M, E, D> = {
    name: input.name,
    init: input.init,
    update: input.update,
    view: input.view,
    __compilerVersion: '__test__',
  }
  if (input.onEffect) out.onEffect = input.onEffect
  return out
}

/**
 * Idempotently stamp a `ComponentDef` with the `'__test__'`
 * `__compilerVersion` sentinel. Used by test-harness adapters
 * (`@llui/test`'s `testView`) that accept a `ComponentDef` from caller
 * code: if the caller already used `defineTestComponent` (or supplied
 * a real compiled def), the existing version is preserved; otherwise
 * the sentinel silences `warnUncompiledOnce`.
 *
 * Lives inside @llui/dom because `__compilerVersion` is `@internal`
 * and stripped from the dist `.d.ts`; external code can't address the
 * field by name. v2b §6.
 */
export function stampTestVersion<S, M, E, D>(
  def: ComponentDef<S, M, E, D>,
): ComponentDef<S, M, E, D> {
  if (def.__compilerVersion) return def
  return { ...def, __compilerVersion: '__test__' }
}
