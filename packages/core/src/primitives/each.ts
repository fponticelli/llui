import type { EachOptions, Scope } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import type { StructuralBlock } from '../structural'

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
  const blocks = ctx.structuralBlocks

  const anchor = document.createComment('each')
  const entries: Entry<T>[] = []

  const initialItems = opts.items(ctx.state as S)
  for (let i = 0; i < initialItems.length; i++) {
    const item = initialItems[i]!
    const entry = buildEntry(item, i, opts, parentScope, ctx)
    entries.push(entry)
  }

  const block: StructuralBlock = {
    reconcile(state: unknown) {
      const parent = anchor.parentNode
      if (!parent) return

      const newItems = opts.items(state as S)
      reconcileEntries(entries, newItems, opts, parentScope, parent, anchor, ctx, state)
    },
  }

  blocks.push(block)

  parentScope.disposers.push(() => {
    const idx = blocks.indexOf(block)
    if (idx !== -1) blocks.splice(idx, 1)
    for (const entry of entries) {
      disposeScope(entry.scope)
    }
    entries.length = 0
  })

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
  ctx: ReturnType<typeof getRenderContext>,
  state?: unknown,
): Entry<T> {
  const key = opts.key(item)
  const scope = createScope(parentScope)
  const ref = { current: item, index }

  const itemAccessor = <R>(selector: (t: T) => R): (() => R) => {
    const accessor = () => selector(ref.current)
    accessor.__perItem = true as const
    return accessor
  }

  const indexAccessor = (): number => ref.index

  setRenderContext({ ...ctx, rootScope: scope, state: state ?? ctx.state })
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
  ctx: ReturnType<typeof getRenderContext>,
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
      const itemChanged = !Object.is(existing.item, item)
      existing.item = item
      existing.ref.current = item
      existing.ref.index = i
      existing.scope.eachItemStable = !itemChanged
      newEntries.push(existing)
    } else {
      const entry = buildEntry(item, i, opts, parentScope, ctx, state)
      newEntries.push(entry)
    }
  }

  for (const entry of entries) {
    if (!usedKeys.has(entry.key)) {
      for (const node of entry.nodes) {
        parent.removeChild(node)
      }
      disposeScope(entry.scope)
    }
  }

  let insertBefore = anchor.nextSibling
  for (const entry of newEntries) {
    for (const node of entry.nodes) {
      if (node !== insertBefore) {
        parent.insertBefore(node, insertBefore)
      } else {
        insertBefore = insertBefore?.nextSibling ?? null
      }
    }
    const lastNode = entry.nodes[entry.nodes.length - 1]
    if (lastNode) {
      insertBefore = lastNode.nextSibling
    }
  }

  entries.length = 0
  entries.push(...newEntries)
}
