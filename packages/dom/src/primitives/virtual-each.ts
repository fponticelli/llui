import type { ItemAccessor, Scope, Send } from '../types.js'
import {
  getRenderContext,
  setRenderContext,
  clearRenderContext,
  type RenderContext,
} from '../render-context.js'
import { createScope, disposeScope, addDisposer } from '../scope.js'
import { getFlatBindings, setFlatBindings } from '../binding.js'
import { FULL_MASK } from '../update-loop.js'
import type { StructuralBlock } from '../structural.js'

export interface VirtualEachOptions<S, T, M = unknown> {
  items: (s: S) => T[]
  key: (item: T) => string | number
  /** Fixed pixel height per item. Required — dynamic heights are not supported yet. */
  itemHeight: number
  /** Scrollable container height in pixels. */
  containerHeight: number
  /** Extra rows to render above/below the viewport for smooth scrolling. Default: 3. */
  overscan?: number
  /** Optional class for the scroll container. */
  class?: string
  render: (opts: {
    send: Send<M>
    item: ItemAccessor<T>
    acc: <R>(selector: (t: T) => R) => () => R
    index: () => number
  }) => Node[]
}

interface VirtualEntry<T> {
  key: string | number
  current: T
  index: number
  scope: Scope
  wrapper: HTMLElement
}

const buildCtx: RenderContext = {
  rootScope: null as unknown as Scope,
  state: null,
  allBindings: [],
  structuralBlocks: [],
}

/**
 * Virtualized list — renders only the rows visible in the scroll viewport.
 * Use for lists with 1k+ items where a regular `each()` would be too slow.
 *
 * Current limitations:
 * - Fixed row height (`itemHeight`) — dynamic heights not supported
 * - No transitions / animations
 * - No cross-container reuse (items outside view are fully disposed)
 *
 * ```ts
 * view: ({ text }) => [
 *   ...virtualEach({
 *     items: (s) => s.rows,
 *     key: (r) => r.id,
 *     itemHeight: 40,
 *     containerHeight: 600,
 *     render: ({ item }) => [
 *       div({ class: 'row' }, [text(item.label)]),
 *     ],
 *   }),
 * ]
 * ```
 */
export function virtualEach<S, T, M = unknown>(opts: VirtualEachOptions<S, T, M>): Node[] {
  const ctx = getRenderContext('virtualEach')
  const parentScope = ctx.rootScope
  const blocks = ctx.structuralBlocks
  const send = ctx.send as (msg: M) => void

  const overscan = opts.overscan ?? 3

  // Scroll container
  const scroll = document.createElement('div')
  scroll.style.overflow = 'auto'
  scroll.style.position = 'relative'
  scroll.style.height = `${opts.containerHeight}px`
  scroll.dataset.virtualContainer = ''
  if (opts.class) scroll.className = opts.class

  // Inner spacer sized to full content height
  const spacer = document.createElement('div')
  spacer.style.position = 'relative'
  spacer.style.width = '100%'
  spacer.dataset.virtualSpacer = ''
  scroll.appendChild(spacer)

  // Map of key → entry
  const entries = new Map<string | number, VirtualEntry<T>>()
  let lastItems: T[] = []
  let scrollTop = 0

  const computeRange = (length: number): [number, number] => {
    if (length === 0) return [0, 0]
    const start = Math.max(0, Math.floor(scrollTop / opts.itemHeight) - overscan)
    const end = Math.min(
      length,
      Math.ceil((scrollTop + opts.containerHeight) / opts.itemHeight) + overscan,
    )
    return [start, end]
  }

  const buildEntry = (item: T, index: number, state: S): VirtualEntry<T> => {
    const key = opts.key(item)
    const scope = createScope(parentScope)

    const wrapper = document.createElement('div')
    wrapper.style.position = 'absolute'
    wrapper.style.top = `${index * opts.itemHeight}px`
    wrapper.style.left = '0'
    wrapper.style.right = '0'
    wrapper.style.height = `${opts.itemHeight}px`
    wrapper.dataset.virtualItem = ''
    wrapper.dataset.virtualKey = String(key)

    const entry: VirtualEntry<T> = { key, current: item, index, scope, wrapper }

    // Item accessor: item(selector) and item.field
    const itemFn = <R>(selector: (t: T) => R): (() => R) => {
      const accessor = (): R => selector(entry.current)
      ;(accessor as unknown as { __perItem: true }).__perItem = true
      return accessor
    }

    let itemProxy: ItemAccessor<T> | null = null
    const getItemProxy = (): ItemAccessor<T> => {
      if (itemProxy) return itemProxy
      const fieldCache = new Map<string, () => unknown>()
      itemProxy = new Proxy(itemFn as object, {
        get(target, prop) {
          if (typeof prop === 'symbol' || prop === 'then' || prop === 'prototype') {
            return Reflect.get(target, prop)
          }
          const k = prop as string
          const cached = fieldCache.get(k)
          if (cached) return cached
          const accessor = (): unknown => (entry.current as Record<string, unknown>)[k]
          ;(accessor as unknown as { __perItem: true }).__perItem = true
          fieldCache.set(k, accessor)
          return accessor
        },
      }) as ItemAccessor<T>
      return itemProxy
    }

    const indexAccessor = (): number => entry.index

    buildCtx.rootScope = scope
    buildCtx.state = state
    buildCtx.allBindings = ctx.allBindings
    buildCtx.structuralBlocks = ctx.structuralBlocks
    const prevFlat = getFlatBindings()
    setFlatBindings(ctx.allBindings)
    setRenderContext(buildCtx)

    const nodes = opts.render({
      send,
      item: getItemProxy(),
      acc: itemFn,
      index: indexAccessor,
    })

    clearRenderContext()
    setFlatBindings(prevFlat)
    setRenderContext(ctx)

    for (const node of nodes) wrapper.appendChild(node)
    return entry
  }

  const reconcile = (state: S): void => {
    const items = opts.items(state)
    lastItems = items

    // Update spacer total height
    spacer.style.height = `${items.length * opts.itemHeight}px`

    if (items.length === 0) {
      // Dispose all entries
      for (const entry of entries.values()) {
        disposeScope(entry.scope)
        if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper)
      }
      entries.clear()
      return
    }

    const [start, end] = computeRange(items.length)

    // Build a map of key → {item, index} for the visible range
    const visibleKeys = new Map<string | number, { item: T; index: number }>()
    for (let i = start; i < end; i++) {
      const item = items[i]!
      visibleKeys.set(opts.key(item), { item, index: i })
    }

    // Dispose entries no longer visible
    for (const [key, entry] of entries) {
      if (!visibleKeys.has(key)) {
        disposeScope(entry.scope)
        if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper)
        entries.delete(key)
      }
    }

    // Create new entries + update existing
    for (const [key, { item, index }] of visibleKeys) {
      const existing = entries.get(key)
      if (existing) {
        existing.current = item
        if (existing.index !== index) {
          existing.index = index
          existing.wrapper.style.top = `${index * opts.itemHeight}px`
        }
      } else {
        const entry = buildEntry(item, index, state)
        entries.set(key, entry)
        spacer.appendChild(entry.wrapper)
      }
    }
  }

  // Scroll handler — reconcile visible range without touching component state
  const onScroll = (): void => {
    scrollTop = scroll.scrollTop
    reconcile(ctx.state as S)
  }
  scroll.addEventListener('scroll', onScroll, { passive: true })

  // Register as a structural block BEFORE initial render so this block
  // precedes any nested blocks its rows register. See branch.ts for the
  // full rationale (Phase 1 iteration safety).
  const block: StructuralBlock = {
    mask: FULL_MASK,
    reconcile(state: unknown) {
      const newItems = opts.items(state as S)
      if (newItems === lastItems) return
      reconcile(state as S)
    },
  }
  blocks.push(block)

  // Initial render
  reconcile(ctx.state as S)

  // Cleanup on parent disposal
  addDisposer(parentScope, () => {
    scroll.removeEventListener('scroll', onScroll)
    for (const entry of entries.values()) {
      disposeScope(entry.scope)
    }
    entries.clear()
  })

  return [scroll]
}
