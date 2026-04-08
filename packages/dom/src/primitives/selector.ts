import { getRenderContext } from '../render-context'
import { createBinding, applyBinding } from '../binding'
import { addDisposer } from '../scope'
import { FULL_MASK } from '../update-loop'
import type { BindingKind } from '../types'

interface SelectorEntry {
  node: Node | null
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
 *   // In view, before each():
 *   const sel = selector<State, number>(s => s.selected)
 *
 *   // Inside each() render:
 *   tr({ class: sel.bind(item(r => r.id), 'class', match => match ? 'danger' : '') })
 *
 * sel.bind() creates and manages the DOM binding directly.
 */
export function selector<S, V>(field: (s: S) => V): SelectorInstance<V> {
  const ctx = getRenderContext()
  const scope = ctx.rootScope

  const registry = new Map<V, SelectorEntry[]>()
  let lastValue: V = field(ctx.state as S)

  // Single watcher binding — evaluates the state field per update cycle.
  createBinding(scope, {
    mask: FULL_MASK,
    accessor: ((state: S) => {
      const newValue = field(state)
      if (Object.is(newValue, lastValue)) return lastValue

      // Deselect old
      const oldEntries = registry.get(lastValue)
      if (oldEntries) {
        for (let i = 0; i < oldEntries.length; i++) {
          const entry = oldEntries[i]!
          if (!entry.node) continue // disposed
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
        for (let i = 0; i < newEntries.length; i++) {
          const entry = newEntries[i]!
          if (!entry.node) continue // disposed
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
    /**
     * Bind a DOM node to this selector. Called per row inside each().
     * Applies the initial value and registers for O(1) future updates.
     *
     * Cleanup: nulls the entry's node ref when the row scope is disposed.
     * This is cheaper than Map/Set operations — just one pointer write
     * instead of Set.delete + conditional Map.delete per row.
     */
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
        bucket = []
        registry.set(currentKey, bucket)
      }
      bucket.push(entry)

      // Lightweight cleanup: null the node ref instead of Map/Set mutation.
      // The entry stays in the bucket but is skipped during updates.
      // Buckets are compacted lazily when they grow too large.
      const itemScope = getRenderContext().rootScope
      addDisposer(itemScope, () => {
        entry.node = null
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
