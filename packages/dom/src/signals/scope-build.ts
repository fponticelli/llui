// Scope construction from collected binding specs.
//
// A build produces a flat list of {@link BindingSpec}s; these helpers turn them
// into a chunked-mask reconciler scope (a {@link ScopeShape} = PathTable + masks),
// with a cache seam so `each` rows that share a template reuse the same shape
// instead of rebuilding the table/masks per row.

import { createSignalScope, type SignalScope } from './runtime.js'
import { buildPathTable, bindingMask, type PathTable, type SparseMask } from './mask.js'
import type { BindingSpec } from './build-context.js'

/** Build a scope from collected specs and publish it to its build host (so
 * structural primitives created in that build can register child scopes). */
export function buildAndPublishScope(built: {
  specs: BindingSpec[]
  host: { scope: SignalScope | null }
}): SignalScope {
  const scope = buildScope(built.specs)
  built.host.scope = scope
  return scope
}

/** A reusable scope shape: the `PathTable` + per-binding masks for one binding
 * structure. `each` rows from a {@link RowFactory} share the template, so their
 * specs carry identical `deps` (hence identical, immutable table + masks) — built
 * ONCE from the first row and reused, skipping per-row `buildPathTable`/`bindingMask`. */
export interface ScopeShape {
  table: PathTable
  masks: readonly SparseMask[]
}

/** Build a scope from specs. With `pre` (a cached {@link ScopeShape} from an
 * earlier row of the same template), the per-row `buildPathTable` + `bindingMask`
 * work is skipped — only the row's own produce/commit closures bind to the shared
 * masks. Returns the scope plus its shape (to seed the cache). */
export function scopeFromSpecs(
  specs: readonly BindingSpec[],
  pre?: ScopeShape,
): { scope: SignalScope; shape: ScopeShape } {
  const table = pre ? pre.table : buildPathTable(specs.flatMap((s) => [...s.deps]))
  const masks = pre ? pre.masks : specs.map((s) => bindingMask(s.deps, table))
  // The specs ARE the bindings (produce/commit) — the scope takes them as-is
  // with the parallel masks array, so no per-binding wrapper object is
  // allocated (`each` builds one scope per ROW; the wrappers were 2 extra
  // objects per jfb row, 20k on a create-10k).
  return { scope: createSignalScope(table, specs, masks), shape: pre ?? { table, masks } }
}

/** Build a chunked-mask reconciler scope over a set of collected bindings. */
export function buildScope(specs: readonly BindingSpec[]): SignalScope {
  return scopeFromSpecs(specs).scope
}

/** Do these specs have the SAME dep structure (count + per-binding dep paths, in
 * order) as a cached signature? When true, a previously-built {@link ScopeShape}
 * (PathTable + masks, derived purely from deps) applies unchanged — so an authoring
 * `each` row can reuse it instead of rebuilding. A cheap array compare (no string
 * alloc) that returns false for data-conditional rows, which then build fresh. */
export function depsSignatureMatches(
  specs: readonly BindingSpec[],
  cached: ReadonlyArray<readonly string[]>,
): boolean {
  if (specs.length !== cached.length) return false
  for (let i = 0; i < specs.length; i++) {
    const a = specs[i]!.deps
    const b = cached[i]!
    if (a.length !== b.length) return false
    for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return false
  }
  return true
}
