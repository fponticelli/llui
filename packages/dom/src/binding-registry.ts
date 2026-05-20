// Binding registry — Option B Phase 1.
//
// Replacement model for the Phase 2 flat-binding-array scan in
// `update-loop.ts`. Bindings register under the compile-time prefix-IDs
// they read (a list of positions in the host component's `__prefixes`
// table). On state change, the runtime walks `__prefixes` to identify
// changed prefix-IDs, then calls `dispatchChanged` to fire the union of
// subscribers — O(changed-prefixes) instead of O(total-bindings).
//
// Phase 1 is a standalone module: data structures + register/unregister/
// dispatch + unit tests. The runtime still uses the flat-array model;
// Phase 2 wires this in behind a per-component flag, Phase 3 makes it the
// only model. See `docs/proposals/v0.5-rebuild/option-b-hybrid-signals.md`.
//
// Data model:
//   - `byPrefix: Map<prefixId, Set<Binding>>` — primary lookup. `Set`
//     preserves insertion order (ES2015 spec), so dispatch fires in
//     mount order without an extra array allocation.
//   - `subscriptions: WeakMap<Binding, readonly prefixId[]>` — reverse
//     index. Used by `unregisterBinding` to find which prefix-sets a
//     binding belongs to in O(prefixIds.length) instead of scanning
//     every set. Weak keying so a binding that's eligible for GC
//     doesn't leak via this map.
//
// Dispatch dedup: a binding registered under multiple changed prefixes
// must fire exactly once per dispatch. We collect-then-iterate via a
// transient `Set<Binding>` rather than firing inside the prefix walk —
// the allocation cost is bounded by the number of subscribers actually
// matched, which is the same upper bound as the flat-array model's
// per-update binding count.

import type { Binding } from './types.js'

export interface BindingRegistry {
  readonly byPrefix: Map<number, Set<Binding>>
  readonly subscriptions: WeakMap<Binding, readonly number[]>
}

export function createBindingRegistry(): BindingRegistry {
  return {
    byPrefix: new Map(),
    subscriptions: new WeakMap(),
  }
}

export function registerBinding(
  reg: BindingRegistry,
  binding: Binding,
  prefixIds: readonly number[],
): void {
  // If the binding was already registered, strip its existing entries
  // first so the prefix-set membership reflects the new declaration.
  // This supports re-registration after a binding's accessor changes
  // (compile-time-uncommon but legal at runtime).
  const existing = reg.subscriptions.get(binding)
  if (existing) removeFromPrefixSets(reg, binding, existing)

  reg.subscriptions.set(binding, prefixIds)
  for (let i = 0; i < prefixIds.length; i++) {
    const id = prefixIds[i]!
    let set = reg.byPrefix.get(id)
    if (!set) {
      set = new Set()
      reg.byPrefix.set(id, set)
    }
    set.add(binding)
  }
}

export function unregisterBinding(reg: BindingRegistry, binding: Binding): void {
  const prefixIds = reg.subscriptions.get(binding)
  if (!prefixIds) return // not registered — idempotent no-op
  removeFromPrefixSets(reg, binding, prefixIds)
  reg.subscriptions.delete(binding)
}

function removeFromPrefixSets(
  reg: BindingRegistry,
  binding: Binding,
  prefixIds: readonly number[],
): void {
  for (let i = 0; i < prefixIds.length; i++) {
    const id = prefixIds[i]!
    const set = reg.byPrefix.get(id)
    if (!set) continue
    set.delete(binding)
    // Drop empty sets so iteration in dispatch doesn't visit dead
    // entries and the map stays tight as components churn.
    if (set.size === 0) reg.byPrefix.delete(id)
  }
}

export function dispatchChanged(
  reg: BindingRegistry,
  changed: readonly number[],
  fire: (binding: Binding) => void,
): void {
  if (changed.length === 0) return

  // Collect-then-iterate so a binding registered under multiple changed
  // prefixes fires exactly once. The set's insertion order is the
  // order in which we encounter the binding via the FIRST changed
  // prefix it matches — which preserves mount order when there's a
  // single changed prefix (the common case), and is well-defined
  // (V8/JSC) for the multi-prefix case.
  const toFire = new Set<Binding>()
  for (let i = 0; i < changed.length; i++) {
    const set = reg.byPrefix.get(changed[i]!)
    if (!set) continue
    for (const binding of set) toFire.add(binding)
  }
  for (const binding of toFire) fire(binding)
}
