import type { EachOptions, Scope } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import { registerStructuralBlock, removeStructuralBlock } from '../structural'
import type { StructuralBlock } from '../structural'

export interface PerItemAccessor {
  (): unknown
  __perItem: true
}

export function isPerItemAccessor(fn: unknown): fn is PerItemAccessor {
  return typeof fn === 'function' && (fn as PerItemAccessor).__perItem === true
}

interface Entry<T> {
  key: string | number
  item: T
  ref: { current: T; index: number }
  scope: Scope
  nodes: Node[]
}

export function each<S, T>(opts: EachOptions<S, T>): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope

  const anchor = document.createComment('each')
  const entries: Entry<T>[] = []

  // Build initial entries
  const initialItems = opts.items(ctx.state as S)
  for (let i = 0; i < initialItems.length; i++) {
    const item = initialItems[i]!
    const entry = buildEntry(item, i, opts, parentScope, ctx.state)
    entries.push(entry)
  }

  const block: StructuralBlock = {
    reconcile(state: unknown) {
      const parent = anchor.parentNode
      if (!parent) return

      const newItems = opts.items(state as S)
      reconcileEntries(entries, newItems, opts, parentScope, parent, anchor, state)
    },
  }

  registerStructuralBlock(block)

  parentScope.disposers.push(() => {
    removeStructuralBlock(block)
    for (const entry of entries) {
      disposeScope(entry.scope)
    }
    entries.length = 0
  })

  // Return anchor + all initial nodes
  const result: Node[] = [anchor]
  for (const entry of entries) {
    result.push(...entry.nodes)
  }
  return result
}

function buildEntry<S, T>(
  item: T,
  index: number,
  opts: EachOptions<S, T>,
  parentScope: Scope,
  state: unknown,
): Entry<T> {
  const key = opts.key(item)
  const scope = createScope(parentScope)
  const ref = { current: item, index }

  // The scoped accessor returns a zero-arg function that resolves the current item.
  // text() and element helpers detect length === 0 as a per-item binding.
  const itemAccessor = <R>(selector: (t: T) => R): (() => R) => {
    const accessor = () => selector(ref.current)
    // Tag it so text()/bindings know it's per-item
    ;(accessor as PerItemAccessor).__perItem = true
    return accessor
  }

  const indexAccessor = (): number => ref.index

  const buildCtx = { rootScope: scope, state }
  setRenderContext(buildCtx)
  const nodes = opts.render(itemAccessor, indexAccessor)
  clearRenderContext()

  return { key, item, ref, scope, nodes }
}

function reconcileEntries<S, T>(
  entries: Entry<T>[],
  newItems: T[],
  opts: EachOptions<S, T>,
  parentScope: Scope,
  parent: Node,
  anchor: Node,
  state: unknown,
): void {
  const oldByKey = new Map<string | number, Entry<T>>()
  for (const entry of entries) {
    oldByKey.set(entry.key, entry)
  }

  const newEntries: Entry<T>[] = []
  const usedKeys = new Set<string | number>()

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i]!
    const key = opts.key(item)
    usedKeys.add(key)

    const existing = oldByKey.get(key)
    if (existing) {
      // Reuse — update item reference, mark stable if unchanged
      const itemChanged = !Object.is(existing.item, item)
      existing.item = item
      existing.ref.current = item
      existing.ref.index = i
      existing.scope.eachItemStable = !itemChanged
      newEntries.push(existing)
    } else {
      // New entry
      const entry = buildEntry(item, i, opts, parentScope, state)
      newEntries.push(entry)
    }
  }

  // Remove entries not in the new list
  for (const entry of entries) {
    if (!usedKeys.has(entry.key)) {
      for (const node of entry.nodes) {
        parent.removeChild(node)
      }
      disposeScope(entry.scope)
    }
  }

  // Reorder DOM to match new order
  // Walk newEntries and ensure each entry's nodes are in the right position
  let insertBefore = anchor.nextSibling
  for (const entry of newEntries) {
    for (const node of entry.nodes) {
      if (node !== insertBefore) {
        parent.insertBefore(node, insertBefore)
      } else {
        insertBefore = insertBefore?.nextSibling ?? null
      }
    }
    // After placing this entry's nodes, the next insert point is after them
    const lastNode = entry.nodes[entry.nodes.length - 1]
    if (lastNode) {
      insertBefore = lastNode.nextSibling
    }
  }

  // Replace the entries array contents
  entries.length = 0
  entries.push(...newEntries)
}
