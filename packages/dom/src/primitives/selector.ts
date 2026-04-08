import { getRenderContext } from '../render-context'
import { createBinding, applyBinding } from '../binding'
import { addDisposer } from '../scope'
import { FULL_MASK } from '../update-loop'
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
 *
 * Usage:
 *   const sel = selector<State, number>(s => s.selected)
 *   // inside each() render:
 *   sel.bind(row, rowId, 'class', 'class', match => match ? 'danger' : '')
 */
export function selector<S, V>(field: (s: S) => V): SelectorInstance<V> {
  const ctx = getRenderContext()
  const scope = ctx.rootScope

  const registry = new Map<V, Set<SelectorEntry>>()
  let lastValue: V = field(ctx.state as S)

  createBinding(scope, {
    mask: FULL_MASK,
    accessor: ((state: S) => {
      const newValue = field(state)
      if (Object.is(newValue, lastValue)) return lastValue

      // Deselect old
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

      // Select new
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
    }) as (state: never) => unknown,
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

      // Cleanup: remove from registry when row scope is disposed.
      // Uses Set.delete (O(1) amortized) — lighter than the previous
      // Map.delete on the key, which required a size check.
      const itemScope = getRenderContext().rootScope
      addDisposer(itemScope, () => {
        bucket!.delete(entry)
      })
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
}
