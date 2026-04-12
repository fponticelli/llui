import { getRenderContext } from '../render-context'
import { createBinding, applyBinding } from '../binding'
import { addDisposer } from '../scope'
import { FULL_MASK } from '../update-loop'
import { registerOnClear } from './each'
import type { BindingKind } from '../types'

interface SelectorEntry {
  node: Node
  kind: BindingKind
  key: string | undefined
  lastValue: unknown
  transform: (match: boolean) => unknown
  gen: number
}

/**
 * Optimized "one-of-N" reactive binding — O(1) updates instead of O(n).
 *
 * Uses a generation counter instead of per-row disposers:
 * - bind() tags entries with the current generation
 * - Individual row removal bumps the generation for that entry (set gen = -1)
 * - Bulk clear bumps the generation and clears the registry via registerOnClear
 * - updateSelector() skips stale entries (gen !== current) and compacts lazily
 *
 * Zero per-row closure allocations. Zero Set.delete calls on disposal.
 */
export function selector<S, V>(field: (s: S) => V): SelectorInstance<V> {
  const ctx = getRenderContext('selector')
  const scope = ctx.rootScope

  const registry = new Map<V, SelectorEntry[]>()
  let lastValue: V = field(ctx.state as S)
  let generation = 0
  let registeredOnClear = false

  function updateBucket(bucket: SelectorEntry[], match: boolean, gen: number): void {
    let hasStale = false
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i]!
      if (entry.gen !== gen) {
        hasStale = true
        continue
      }
      const v = entry.transform(match)
      if (!Object.is(v, entry.lastValue)) {
        entry.lastValue = v
        applyBinding({ kind: entry.kind, node: entry.node, key: entry.key }, v)
      }
    }
    // Lazy compaction — remove stale entries when encountered
    if (hasStale) {
      let w = 0
      for (let r = 0; r < bucket.length; r++) {
        if (bucket[r]!.gen === gen) bucket[w++] = bucket[r]!
      }
      bucket.length = w
    }
  }

  function updateSelector(state: S): V {
    const newValue = field(state)
    if (Object.is(newValue, lastValue)) return lastValue
    const gen = generation

    const oldBucket = registry.get(lastValue)
    if (oldBucket) updateBucket(oldBucket, false, gen)

    const newBucket = registry.get(newValue)
    if (newBucket) updateBucket(newBucket, true, gen)

    lastValue = newValue
    return newValue
  }

  createBinding(scope, {
    mask: FULL_MASK,
    accessor: ((state: S) => updateSelector(state)) as (state: never) => unknown,
    kind: 'text',
    node: document.createComment('selector'),
    perItem: false,
  })

  return {
    bind(
      node: Node,
      key: V | (() => V),
      kind: BindingKind,
      propKey: string | undefined,
      transform: (match: boolean) => unknown,
    ): void {
      const currentKey = typeof key === 'function' ? (key as () => V)() : key
      const initialMatch = Object.is(lastValue, currentKey)
      const initialValue = transform(initialMatch)

      applyBinding({ kind, node, key: propKey }, initialValue)

      const entry: SelectorEntry = {
        node,
        kind,
        key: propKey,
        lastValue: initialValue,
        transform,
        gen: generation,
      }

      let bucket = registry.get(currentKey)
      if (!bucket) {
        bucket = []
        registry.set(currentKey, bucket)
      }
      bucket.push(entry)

      // Register bulk clear callback (once per selector per each() block)
      if (!registeredOnClear) {
        registerOnClear(() => {
          generation++
          registry.clear()
        })
        registeredOnClear = true
      }

      // Per-row disposer for generic reconcile paths (scope disposal).
      // Uses generation check to skip work if already bulk-cleared.
      const gen = generation
      const itemScope = getRenderContext('selector').rootScope
      addDisposer(itemScope, () => {
        if (gen !== generation) return // already bulk-cleared, no-op
        const idx = bucket!.indexOf(entry)
        if (idx !== -1) bucket!.splice(idx, 1)
        if (bucket!.length === 0) registry.delete(currentKey)
      })
    },

    __directUpdate(state: unknown): void {
      updateSelector(state as S)
    },
  }
}

export interface SelectorInstance<V> {
  bind(
    node: Node,
    key: V | (() => V),
    kind: BindingKind,
    propKey: string | undefined,
    transform: (match: boolean) => unknown,
  ): void
  __directUpdate(state: unknown): void
}
