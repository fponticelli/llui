// Row-spec rebasing — re-rooting an enclosing-view binding onto the combined
// `{ item, state, index }` row ctx so a `connect()` part (or any component-state
// signal) composes correctly inside an authoring `each`/`show`/`branch` row.
//
// Locality is decided from the `componentRooted` brand (collision-proof, set from
// the origin handle) with a legacy string-inference fallback for unbranded
// compiler-emitted specs.

import type { BindingSpec } from './build-context.js'

/** A row binding is "row-local" when every dep is rooted in the row ctx — its own
 * `item`/`index`, or the component `state` (compiled rows pre-namespace component
 * reads as `state.*`). Anything else is a handle from the ENCLOSING view (e.g. a
 * `connect()` part rooted at the bare component state) that was placed inside a
 * row by an UNCOMPILED `each`; its produce expects the component state, not the
 * combined row ctx. */
export function isRowLocalDep(d: string): boolean {
  return (
    d === 'item' ||
    d.startsWith('item.') ||
    d === 'index' ||
    d === 'state' ||
    d.startsWith('state.')
  )
}

/** Re-root a single dependency path from the component state onto the combined
 * row ctx: a non-row-local component path `p` becomes `state.p` (and the whole
 * state `''` becomes `state`); row-local paths (`item`/`index`/`state.*`) keep.
 * Used for UNBRANDED (compiler-emitted) deps, where locality is string-inferred. */
export const rebaseRowDep = (d: string): string =>
  isRowLocalDep(d) ? d : d === '' ? 'state' : `state.${d}`

/** Re-root a KNOWN component-state dep onto the combined row ctx UNCONDITIONALLY:
 * every path becomes `ctx.state.<path>` (whole state `''` → `state`). Used when the
 * origin handle is branded component-rooted, so a component field literally named
 * `state`/`item`/`index` is rebased (to `state.state`/…) instead of being mistaken
 * for a row-ctx slot by `rebaseRowDep`'s string inference. */
export const rebaseComponentDep = (d: string): string => (d === '' ? 'state' : `state.${d}`)

/** Does a VALUE spec need re-rooting onto `ctx.state` inside a row? Prefers the
 * `componentRooted` brand (set from the origin handle — collision-proof); falls
 * back to `isRowLocalDep` string inference only for unbranded compiler specs. */
export function specNeedsRebase(spec: BindingSpec): boolean {
  if (spec.structural) return false
  if (spec.componentRooted === true) return true
  if (spec.componentRooted === false) return false
  return spec.deps.some((d) => !isRowLocalDep(d))
}

/** Re-root a component-state-rooted VALUE row spec so it reads `ctx.state` (the
 * component state) instead of the combined row ctx — the fix that lets a
 * `connect()` part (or any enclosing-view signal) compose inside an authoring
 * `each` row. Row-local specs (and all compiled rows) pass through untouched. A
 * BRANDED component-rooted spec rebases ALL its deps (via `rebaseComponentDep`),
 * so a component field named `state`/`item`/`index` resolves correctly; an
 * unbranded spec keeps the legacy `rebaseRowDep` (string inference). */
export function rebaseRowSpec(spec: BindingSpec): BindingSpec {
  if (!specNeedsRebase(spec)) return spec
  const rebaseDep = spec.componentRooted === true ? rebaseComponentDep : rebaseRowDep
  return {
    deps: spec.deps.map(rebaseDep),
    produce: (ctx) => spec.produce((ctx as { state: unknown }).state),
    commit: spec.commit,
    componentRooted: false, // now reads the row ctx
  }
}

/** Rebase every VALUE spec in a row/arm build to read `ctx.state`, leaving
 * STRUCTURAL specs (show/branch/each) untouched — they make themselves row-aware
 * at build time (`c.inRow`), so rewriting their identity produce would break the
 * arm/row mount. */
export function rebaseRowSpecs(specs: readonly BindingSpec[]): BindingSpec[] {
  return specs.map((s) => (s.structural ? s : rebaseRowSpec(s)))
}
