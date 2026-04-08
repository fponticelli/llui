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
}

/**
 * Optimized "one-of-N" reactive binding — O(1) updates instead of O(n).
 *
 * Watches a state field and compares it against per-item keys. When the
 * field changes, only the old and new matching rows update their DOM.
 */
export function selector<S, V>(field: (s: S) => V): SelectorInstance<V> {
  const ctx = getRenderContext()
  const scope = ctx.rootScope

  const registry = new Map<V, Set<SelectorEntry>>()
  let lastValue: V = field(ctx.state as S)
  let registeredOnClear = false

  function updateSelector(state: S): V {
    const newValue = field(state)
    if (Object.is(newValue, lastValue)) return lastValue

    const oldEntries = registry.get(lastValue)
    if (oldEntries) {
      for (const entry of oldEntries) {
        const v = entry.transform(false)
        if (!Object.is(v, entry.lastValue)) {
          entry.lastValue = v
          applyBinding({ kind: entry.kind, node: entry.node, key: entry.key }, v)
        }
      }
    }

    const newEntries = registry.get(newValue)
    if (newEntries) {
      for (const entry of newEntries) {
        const v = entry.transform(true)
        if (!Object.is(v, entry.lastValue)) {
          entry.lastValue = v
          applyBinding({ kind: entry.kind, node: entry.node, key: entry.key }, v)
        }
      }
    }

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
      }

      let bucket = registry.get(currentKey)
      if (!bucket) {
        bucket = new Set()
        registry.set(currentKey, bucket)
      }
      bucket.add(entry)

      // Register bulk clear instead of per-row disposer.
      // On first bind, register registry.clear() with the enclosing each() block.
      // This replaces 1000 individual Set.delete calls with 1 Map.clear() call.
      if (!registeredOnClear) {
        registerOnClear(() => registry.clear())
        registeredOnClear = true
      }

      // Individual disposal fallback for single-row removal (not bulk clear)
      const itemScope = getRenderContext().rootScope
      addDisposer(itemScope, () => {
        bucket!.delete(entry)
        if (bucket!.size === 0) registry.delete(currentKey)
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
