import type { EachOptions, Scope } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import { setFlatBindings } from '../binding'
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

  let lastItemsRef = initialItems

  const block: StructuralBlock = {
    reconcile(state: unknown) {
      const parent = anchor.parentNode
      if (!parent) return

      const newItems = opts.items(state as S)

      // Fast path: same array reference → skip entirely
      if (newItems === lastItemsRef) {
        for (const entry of entries) entry.scope.eachItemStable = true
        return
      }
      lastItemsRef = newItems

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

  setFlatBindings(ctx.allBindings)
  setRenderContext({ ...ctx, rootScope: scope, state: state ?? ctx.state })
  const nodes = opts.render(itemAccessor, indexAccessor)
  clearRenderContext()
  setFlatBindings(null)
  setRenderContext(ctx)

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
  const oldLen = entries.length
  const newLen = newItems.length

  // Fast path 1: clear all — bulk DOM removal
  if (newLen === 0) {
    // Remove all DOM nodes in one operation using Range
    if (entries.length > 0) {
      const range = document.createRange()
      range.setStartAfter(anchor)
      const lastEntry = entries[entries.length - 1]!
      const lastNode = lastEntry.nodes[lastEntry.nodes.length - 1]!
      range.setEndAfter(lastNode)
      range.deleteContents()
    }
    // Dispose scopes (no DOM work — nodes already removed)
    for (const entry of entries) disposeScope(entry.scope)
    entries.length = 0
    return
  }

  // Fast path 2: append-only — old keys are a prefix of new keys
  if (newLen > oldLen && isAppendOnly(entries, newItems, opts)) {
    for (let i = 0; i < oldLen; i++) {
      updateEntry(entries[i]!, newItems[i]!, i)
    }
    // Find insertion point: after last existing entry's last node, or after anchor
    const lastEntry = oldLen > 0 ? entries[oldLen - 1]! : null
    const ref = lastEntry
      ? lastEntry.nodes[lastEntry.nodes.length - 1]!.nextSibling
      : anchor.nextSibling
    const frag = document.createDocumentFragment()
    for (let i = oldLen; i < newLen; i++) {
      const entry = buildEntry(newItems[i]!, i, opts, parentScope, ctx, state)
      entries.push(entry)
      for (const node of entry.nodes) frag.appendChild(node)
    }
    parent.insertBefore(frag, ref)
    return
  }

  // Fast path 3: two-element swap — same keys, exactly two positions differ
  if (newLen === oldLen && oldLen >= 2) {
    const swapResult = detectSwap(entries, newItems, opts)
    if (swapResult) {
      const [i, j] = swapResult
      const entryI = entries[i]!
      const entryJ = entries[j]!

      // Capture reference nodes before any DOM mutation
      const refI = entryI.nodes[0]!
      const refAfterJ = entryJ.nodes[entryJ.nodes.length - 1]!.nextSibling

      // Move J's nodes to where I was
      for (const node of entryJ.nodes) parent.insertBefore(node, refI)
      // Move I's nodes to where J was (after J's last node's original position)
      for (const node of entryI.nodes) parent.insertBefore(node, refAfterJ)

      // Swap entries in the array
      entries[i] = entryJ
      entries[j] = entryI

      // Update all entries' refs
      for (let k = 0; k < oldLen; k++) {
        updateEntry(entries[k]!, newItems[k]!, k)
      }
      return
    }
  }

  // Fast path 4: full replace — no shared keys between old and new
  // Quick check: first key mismatch → likely full replace, verify with Set
  if (oldLen > 0 && opts.key(newItems[0]!) !== entries[0]!.key) {
    const oldKeys = new Set<string | number>()
    for (const entry of entries) oldKeys.add(entry.key)
    let anyShared = false
    for (let i = 0; i < newLen; i++) {
      if (oldKeys.has(opts.key(newItems[i]!))) { anyShared = true; break }
    }
    if (!anyShared) {
      // Bulk DOM removal using Range
      const range = document.createRange()
      range.setStartAfter(anchor)
      const lastEntry = entries[entries.length - 1]!
      range.setEndAfter(lastEntry.nodes[lastEntry.nodes.length - 1]!)
      range.deleteContents()
      for (const entry of entries) disposeScope(entry.scope)
      entries.length = 0
      // Build all new entries into a fragment
      const frag = document.createDocumentFragment()
      for (let i = 0; i < newLen; i++) {
        const entry = buildEntry(newItems[i]!, i, opts, parentScope, ctx, state)
        entries.push(entry)
        for (const node of entry.nodes) frag.appendChild(node)
      }
      parent.insertBefore(frag, anchor.nextSibling)
      return
    }
  }

  // General path: keyed reconciliation
  const oldByKey = new Map<string | number, Entry<T>>()
  for (const entry of entries) {
    oldByKey.set(entry.key, entry)
  }

  const newEntries: Entry<T>[] = []
  const usedKeys = new Set<string | number>()

  for (let i = 0; i < newLen; i++) {
    const item = newItems[i]!
    const key = opts.key(item)
    usedKeys.add(key)

    const existing = oldByKey.get(key)
    if (existing) {
      updateEntry(existing, item, i)
      newEntries.push(existing)
    } else {
      const entry = buildEntry(item, i, opts, parentScope, ctx, state)
      newEntries.push(entry)
    }
  }

  // Remove entries not in the new list
  for (const entry of entries) {
    if (!usedKeys.has(entry.key)) {
      for (const node of entry.nodes) parent.removeChild(node)
      disposeScope(entry.scope)
    }
  }

  // Reorder DOM
  const hasSurvivors = newEntries.some((e) => oldByKey.has(e.key))

  if (!hasSurvivors || !survivorsInOrder(entries, newEntries, usedKeys)) {
    // Full fragment rebuild — one reflow
    const frag = document.createDocumentFragment()
    for (const entry of newEntries) {
      for (const node of entry.nodes) frag.appendChild(node)
    }
    parent.insertBefore(frag, anchor.nextSibling)
  } else {
    // Survivors in order — batch-insert new entries between survivors
    let frag: DocumentFragment | null = null
    let insertRef: ChildNode | null = anchor.nextSibling
    for (const entry of newEntries) {
      if (oldByKey.has(entry.key)) {
        // Flush any pending fragment before this survivor
        if (frag) { parent.insertBefore(frag, insertRef); frag = null }
        // Skip past survivor's nodes
        const lastNode = entry.nodes[entry.nodes.length - 1]
        insertRef = lastNode ? lastNode.nextSibling : insertRef
      } else {
        // Batch new entries into a fragment
        if (!frag) frag = document.createDocumentFragment()
        for (const node of entry.nodes) frag.appendChild(node)
      }
    }
    if (frag) parent.insertBefore(frag, insertRef)
  }

  entries.length = 0
  entries.push(...newEntries)
}

function updateEntry<T>(entry: Entry<T>, item: T, index: number): void {
  const changed = !Object.is(entry.item, item)
  entry.item = item
  entry.ref.current = item
  entry.ref.index = index
  entry.scope.eachItemStable = !changed
}

function isAppendOnly<S, T>(
  entries: Entry<T>[],
  newItems: T[],
  opts: EachOptions<S, T>,
): boolean {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.key !== opts.key(newItems[i]!)) return false
  }
  return true
}

function detectSwap<S, T>(
  entries: Entry<T>[],
  newItems: T[],
  opts: EachOptions<S, T>,
): [number, number] | null {
  let diff1 = -1
  let diff2 = -1
  let diffCount = 0

  for (let i = 0; i < entries.length; i++) {
    const newKey = opts.key(newItems[i]!)
    if (entries[i]!.key !== newKey) {
      diffCount++
      if (diffCount === 1) diff1 = i
      else if (diffCount === 2) diff2 = i
      else return null // more than 2 differences
    }
  }

  if (diffCount !== 2) return null

  // Verify it's actually a swap (keys are exchanged)
  const oldKey1 = entries[diff1]!.key
  const oldKey2 = entries[diff2]!.key
  const newKey1 = opts.key(newItems[diff1]!)
  const newKey2 = opts.key(newItems[diff2]!)

  if (oldKey1 === newKey2 && oldKey2 === newKey1) {
    return [diff1, diff2]
  }

  return null
}

function survivorsInOrder<T>(
  oldEntries: Entry<T>[],
  newEntries: Entry<T>[],
  usedKeys: Set<string | number>,
): boolean {
  // Build old-index map for survivors
  const oldIndexMap = new Map<string | number, number>()
  for (let i = 0; i < oldEntries.length; i++) {
    if (usedKeys.has(oldEntries[i]!.key)) {
      oldIndexMap.set(oldEntries[i]!.key, i)
    }
  }
  // Check that survivors appear in increasing old-index order in newEntries
  let maxOldIndex = -1
  for (const entry of newEntries) {
    const oldIdx = oldIndexMap.get(entry.key)
    if (oldIdx === undefined) continue // new entry, skip
    if (oldIdx < maxOldIndex) return false
    maxOldIndex = oldIdx
  }
  return true
}
