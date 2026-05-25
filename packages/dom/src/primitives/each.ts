import type { EachOptions, ItemAccessor, Lifetime } from '../types.js'
import type { View } from '../view-helpers.js'
import {
  captureRenderContext,
  setRenderContext,
  clearRenderContext,
  enterAccessor,
  exitAccessor,
  getInstanceViewBag,
  type RenderContext,
} from '../render-context.js'
import {
  createLifetime,
  disposeLifetime,
  disposeLifetimesBulk,
  addDisposer,
  removeOrphanedChildren,
} from '../lifetime.js'
import { getFlatBindings, setFlatBindings } from '../binding.js'
import { FULL_MASK } from '../update-loop.js'
import type { StructuralBlock } from '../structural.js'
import { pushTrace } from '../dev-trace.js'
// v0.4 size-cut (Tier 1.2): no more createView fallback — every compiled
// component carries a __view factory; each() pulls the bag from the owning
// instance via the render context.

// Clear callbacks — registered by selector.bind() during render, called by reconcileClear().
// Eliminates per-row disposers (1000 Set.delete calls → 1 registry.clear() call).
let activeClearCallbacks: Array<() => void> | null = null
let activeRemoveCallbacks: Array<(key: string | number) => void> | null = null

// Dev-only monotonic id for each() blocks — used by the runtime trace
// ring buffer (window.__lluiTrace) so each block has a stable identifier
// independent of its current index in inst.structuralBlocks.
let nextEachSiteId = 0

/** Register a callback to run when the current each() block clears. */
export function registerOnClear(cb: () => void): void {
  if (activeClearCallbacks) activeClearCallbacks.push(cb)
}

/** Register a callback to run when a single row is removed by key. */
export function registerOnRemove(cb: (key: string | number) => void): void {
  if (activeRemoveCallbacks) activeRemoveCallbacks.push(cb)
}

// Wrap accessor invocations so `sample()` calls inside them throw a targeted
// error. The wrappers also localise the contract: every items/key call goes
// through these, so a future change (e.g. instrumentation) has one site.
function callItems<S, T>(opts: { items: (s: S) => T[] }, state: S): T[] {
  enterAccessor('each().items')
  try {
    return opts.items(state)
  } finally {
    exitAccessor()
  }
}
function callKey<T>(opts: { key: (t: T) => string | number }, item: T): string | number {
  enterAccessor('each().key')
  try {
    return opts.key(item)
  } finally {
    exitAccessor()
  }
}

// Reusable render context for buildEntry — avoids object allocation per entry.
// Every field is overwritten from the surrounding context per reconcile call
// (see buildEntry), so the initial shape's null/empty values are never observed
// in practice.
const buildCtx: RenderContext = {
  rootLifetime: null as unknown as Lifetime,
  state: null,
  allBindings: [],
  structuralBlocks: [],
  dom: null as unknown as import('../dom-env.js').DomEnv,
}

// Reusable render bag — mutated per entry instead of allocating new objects
const buildBag: Record<string, unknown> = {
  send: null,
  get item() {
    return (buildBag._getItemProxy as () => unknown)()
  },
  acc: null,
  index: null,
  _getItemProxy: null,
}

interface Entry<T> {
  key: string | number
  item: T
  current: T
  index: number
  scope: Lifetime
  nodes: Node[]
  /** Per-item updaters — stored on entry directly to avoid scope overhead for leaf rows */
  updaters: Array<() => void>
}

export function each<S, T, M = unknown>(opts: EachOptions<S, T, M>): Node[] {
  // Stable snapshot of the live render context. The reconcile path
  // threads `ctx` through to `reconcileEntries → buildEntry`, and
  // `buildEntry` reads `ctx.structuralBlocks` / `ctx.allBindings` to
  // register newly built inner-each blocks and bindings. Without the
  // snapshot those lazy reads return the shared `buildCtx` singleton's
  // CURRENT fields — which an intervening sub-app's buildEntry may
  // have repointed at the sub-app's own arrays. See
  // `captureRenderContext` for the full rationale; regression in
  // `test/nested-each-cross-instance-blocks.test.ts`.
  const ctx = captureRenderContext('each')
  const parentLifetime = ctx.rootLifetime
  const blocks = ctx.structuralBlocks

  const anchor = ctx.dom.createComment('each')
  // End-of-territory sentinel. Bulk Range ops (reconcileClear, Fast path
  // 1, Fast path 5) used to setEndAfter the last entry's last node, but
  // when a nested structural primitive replaced its own entries between
  // the outer render snapshot and the next outer reconcile, that captured
  // node could be detached — Range#setEndAfter throws InvalidNodeTypeError
  // on a parent-less node. Anchoring the range with two stable comments
  // (owned by this each) makes the bulk-remove correct regardless of any
  // inner-each / show / branch mutation that happened in between.
  const endAnchor = ctx.dom.createComment('each-end')
  const entries: Entry<T>[] = []
  const clearCallbacks: Array<() => void> = []
  const removeCallbacks: Array<(key: string | number) => void> = []
  // Entries whose leave animation is still in progress. Their DOM nodes
  // remain in the parent until the leave Promise resolves.
  const leaving: Entry<T>[] = []

  const initialItems = callItems(opts, ctx.state as S)
  let lastItemsRef = initialItems

  // Dev-only diff tracking: if the owning component has an _eachDiffLog
  // (installed by devtools), we capture key sets before/after each
  // key-mutating reconcile call and emit an EachDiff entry. Wrapped in
  // `import.meta.env?.DEV` so production builds dead-code the entire
  // block — saves ~1-2 kB in the prod bundle. The reconcile-side call
  // sites are also gated below; the stubs (`null`/no-op) keep types
  // and call sites consistent across modes.
  const inst = ctx.instance
  let snapshotKeys: () => string[] | null = () => null
  let emitDiff: (oldKeys: string[] | null) => void = () => {}
  // Stable id for this each() across reconciles AND across splices /
  // moves of `blocks`. Uses a module-level monotonic counter so the
  // trace ring buffer's `each#N` IDs remain unique through register /
  // unregister cycles. Without this, two blocks could share an ID if
  // one was unregistered and another took its slot in the array,
  // breaking trace-to-block correspondence.
  const eachSiteId = import.meta.env?.DEV ? `each#${nextEachSiteId++}` : ''
  if (import.meta.env?.DEV) {
    snapshotKeys = (): string[] | null => {
      if (inst?._eachDiffLog === undefined) return null
      const keys: string[] = []
      for (let i = 0; i < entries.length; i++) keys.push(String(entries[i]!.key))
      return keys
    }
    emitDiff = (oldKeys: string[] | null): void => {
      if (oldKeys === null || inst?._eachDiffLog === undefined) return
      const newKeys: string[] = []
      for (let i = 0; i < entries.length; i++) newKeys.push(String(entries[i]!.key))
      const oldKeySet = new Set(oldKeys)
      const newKeySet = new Set(newKeys)
      const added: string[] = []
      const removed: string[] = []
      const moved: Array<{ key: string; from: number; to: number }> = []
      const reused: string[] = []
      for (const k of newKeys) if (!oldKeySet.has(k)) added.push(k)
      for (const k of oldKeys) if (!newKeySet.has(k)) removed.push(k)
      for (let i = 0; i < newKeys.length; i++) {
        const k = newKeys[i]!
        if (!oldKeySet.has(k)) continue
        const from = oldKeys.indexOf(k)
        if (from !== i) moved.push({ key: k, from, to: i })
        else reused.push(k)
      }
      inst._eachDiffLog.push({
        updateIndex: inst._updateCounter ?? 0,
        eachSiteId,
        added,
        removed,
        moved,
        reused,
      })
    }
  }

  const blockMask = (opts as { __mask?: number }).__mask ?? FULL_MASK
  const blockMaskHi = (opts as { __maskHi?: number }).__maskHi ?? 0
  const block: StructuralBlock = {
    mask: blockMask,
    maskHi: blockMaskHi,
    __siteId: import.meta.env?.DEV ? eachSiteId : undefined,
    reconcile(state: unknown, dirty: number, dirtyHi: number) {
      const parent = anchor.parentNode
      // Trace the reconcile entry — captured BEFORE the parent-null
      // early-return so we can see "block exists but its DOM was
      // detached" cases too.
      const traceItemsLenBefore = entries.length
      const traceKeysBefore: Array<string | number> = import.meta.env?.DEV
        ? entries.map((e) => e.key)
        : []
      if (!parent) {
        if (import.meta.env?.DEV) {
          pushTrace({
            kind: 'reconcile',
            t: Date.now(),
            blockId: eachSiteId,
            mask: blockMask,
            maskHi: blockMaskHi,
            dirty,
            dirtyHi,
            gateOpen: false,
            itemsLenBefore: traceItemsLenBefore,
            itemsLenAfter: traceItemsLenBefore,
            itemsRefChanged: false,
            keysBefore: traceKeysBefore,
            keysAfter: traceKeysBefore,
          })
        }
        return
      }

      const newItems = callItems(opts, state as S)
      const itemsRefChanged = newItems !== lastItemsRef

      // Fast path: same array reference → skip entirely.
      if (!itemsRefChanged) {
        if (import.meta.env?.DEV) {
          pushTrace({
            kind: 'reconcile',
            t: Date.now(),
            blockId: eachSiteId,
            mask: blockMask,
            maskHi: blockMaskHi,
            dirty,
            dirtyHi,
            gateOpen: true,
            itemsLenBefore: traceItemsLenBefore,
            itemsLenAfter: newItems.length,
            itemsRefChanged: false,
            keysBefore: traceKeysBefore,
            keysAfter: traceKeysBefore,
          })
        }
        return
      }
      lastItemsRef = newItems

      const oldKeys = snapshotKeys()
      // Transition support gated by `__LLUI_TRANSITIONS__` build flag.
      // When false, the `report` allocation, the `onTransition` invocation,
      // and (via type narrowing inside `reconcileEntries`) the per-entry
      // leave/enter helpers all dead-code-eliminate.
      const report =
        typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && opts.onTransition
          ? ({ entering: [] as Node[], leaving: [] as Node[] } as const)
          : null
      reconcileEntries(
        entries,
        newItems,
        opts,
        parentLifetime,
        parent,
        anchor,
        endAnchor,
        ctx,
        state,
        leaving,
        report,
      )
      if (
        typeof __LLUI_TRANSITIONS__ !== 'undefined' &&
        __LLUI_TRANSITIONS__ &&
        opts.onTransition
      ) {
        opts.onTransition({ entering: report!.entering, leaving: report!.leaving, parent })
      }
      emitDiff(oldKeys)
      if (import.meta.env?.DEV) {
        pushTrace({
          kind: 'reconcile',
          t: Date.now(),
          blockId: eachSiteId,
          mask: blockMask,
          maskHi: blockMaskHi,
          dirty,
          dirtyHi,
          gateOpen: true,
          itemsLenBefore: traceItemsLenBefore,
          itemsLenAfter: newItems.length,
          itemsRefChanged: true,
          keysBefore: traceKeysBefore,
          keysAfter: entries.map((e) => e.key),
        })
      }
    },

    /** Same keys, only item data changed — skip mismatch/swap detection.
     *  Compiler calls this when it knows the array structure is unchanged. */
    reconcileItems(state: unknown) {
      const newItems = callItems(opts, state as S)
      lastItemsRef = newItems
      const len = Math.min(entries.length, newItems.length)
      for (let i = 0; i < len; i++) {
        const entry = entries[i]!
        const newItem = newItems[i]!
        if (entry.item !== newItem) {
          updateEntry(entry, newItem, i)
        }
      }
    },

    /** Remove all items — skip items accessor, go straight to clear path. */
    reconcileClear() {
      lastItemsRef = [] as unknown as T[]
      const parent = anchor.parentNode
      if (!parent) return
      if (entries.length === 0) return

      const oldKeys = snapshotKeys()

      // Call registered clear callbacks (e.g., selector registry.clear())
      // BEFORE scope disposal — avoids 1000 individual Set.delete calls
      for (let i = 0; i < clearCallbacks.length; i++) clearCallbacks[i]!()

      // Bulk DOM removal — anchored on this each's own start/end sentinels
      // so a nested primitive that replaced its own captured nodes between
      // the outer snapshot and now can't make this throw.
      const range = ctx.dom.createRange()
      range.setStartAfter(anchor)
      range.setEndBefore(endAnchor)
      range.deleteContents()

      // Bulk scope disposal — disposers that were replaced by clearCallbacks
      // are now no-ops, making this much faster
      const scopes: Lifetime[] = []
      for (let i = 0; i < entries.length; i++) {
        const s = entries[i]!.scope
        if (import.meta.env?.DEV) s.disposalCause = 'each-remove'
        scopes.push(s)
      }
      disposeLifetimesBulk(scopes)
      removeOrphanedChildren(parentLifetime)
      entries.length = 0

      emitDiff(oldKeys)
    },

    /** Remove entries not present in the new items. Optimized for filter()
     *  patterns where items are removed but order is preserved. Walks old
     *  and new arrays in parallel — O(n) with no Map/Set allocation. */
    reconcileRemove(state: unknown) {
      const newItems = callItems(opts, state as S)
      lastItemsRef = newItems
      const parent = anchor.parentNode
      if (!parent) return

      const oldKeys = snapshotKeys()
      const oldLen = entries.length
      const newLen = newItems.length
      if (newLen >= oldLen) {
        // Not a removal — fallback (shouldn't happen if compiler detected correctly)
        reconcileEntries(
          entries,
          newItems,
          opts,
          parentLifetime,
          parent,
          anchor,
          endAnchor,
          ctx,
          state,
          leaving,
          null,
        )
        emitDiff(oldKeys)
        return
      }

      // Parallel walk: new items are a subsequence of old items (same order, some removed)
      let ni = 0
      let didRemove = false
      for (let oi = 0; oi < oldLen; oi++) {
        const entry = entries[oi]!
        if (ni < newLen && entry.key === callKey(opts, newItems[ni]!)) {
          // Entry survives — update if item ref changed
          if (entry.item !== newItems[ni]) {
            updateEntry(entry, newItems[ni]!, ni)
          }
          ni++
        } else {
          // Entry removed — notify selectors before scope disposal
          for (let ci = 0; ci < removeCallbacks.length; ci++) removeCallbacks[ci]!(entry.key)
          for (const node of entry.nodes) parent.removeChild(node)
          if (import.meta.env?.DEV) entry.scope.disposalCause = 'each-remove'
          disposeLifetime(entry.scope, true)
          entries[oi] = null!
          didRemove = true
        }
      }

      // Compact entries array
      if (didRemove) {
        let w = 0
        for (let r = 0; r < oldLen; r++) {
          if (entries[r]) entries[w++] = entries[r]!
        }
        entries.length = w
        removeOrphanedChildren(parentLifetime)
      }

      // Update indices for remaining entries
      for (let i = 0; i < entries.length; i++) {
        entries[i]!.index = i
      }

      emitDiff(oldKeys)
    },

    /** Update only entries at stride intervals — O(k) where k = n/stride.
     *  The compiler passes the stride from the detected for-loop pattern. */
    reconcileChanged(state: unknown, stride: number) {
      const newItems = callItems(opts, state as S)
      lastItemsRef = newItems
      for (let i = 0; i < entries.length && i < newItems.length; i += stride) {
        const entry = entries[i]!
        const newItem = newItems[i]!
        if (entry.item !== newItem) {
          updateEntry(entry, newItem, i)
        }
      }
    },
  }

  // Register the block BEFORE building initial row entries so that this
  // each() block precedes any nested structural blocks its rows register.
  // Parents must come first in the flat blocks array — see branch.ts for
  // the full rationale (Phase 1 iteration safety when disposing nested).
  blocks.push(block)
  if (import.meta.env?.DEV) {
    pushTrace({
      kind: 'block',
      t: Date.now(),
      blockId: eachSiteId,
      op: 'register',
      mask: blockMask,
      maskHi: blockMaskHi,
      parentLifetimeId: (parentLifetime as { id?: string | number }).id ?? '?',
    })
  }

  // Save / restore prior values rather than null-clearing — when this
  // each() is itself nested inside an outer each's render callback,
  // the outer set these singletons to its own clear/remove arrays so
  // any selector.bind() called from inside outer's render (including
  // after this nested each() returns) registers against the OUTER's
  // each, not this nested one. Hard-clearing to null on the way out
  // silently strips the outer's clear-callback registration window.
  const prevActiveClear = activeClearCallbacks
  const prevActiveRemove = activeRemoveCallbacks
  activeClearCallbacks = clearCallbacks
  activeRemoveCallbacks = removeCallbacks
  for (let i = 0; i < initialItems.length; i++) {
    const item = initialItems[i]!
    const entry = buildEntry(item, i, opts, parentLifetime, ctx)
    entries.push(entry)
  }
  activeClearCallbacks = prevActiveClear
  activeRemoveCallbacks = prevActiveRemove

  // Fire initial enter for mount-time items. Build-flag-gated:
  // `__LLUI_TRANSITIONS__` lets the DCE drop this loop when the app
  // doesn't use animation callbacks.
  if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && opts.enter) {
    for (const entry of entries) {
      if (entry.nodes.length > 0) opts.enter(entry.nodes)
    }
  }

  addDisposer(parentLifetime, () => {
    const idx = blocks.indexOf(block)
    if (idx !== -1) blocks.splice(idx, 1)
    if (import.meta.env?.DEV) {
      pushTrace({
        kind: 'block',
        t: Date.now(),
        blockId: eachSiteId,
        op: 'unregister',
        mask: blockMask,
        maskHi: blockMaskHi,
        parentLifetimeId: (parentLifetime as { id?: string | number }).id ?? '?',
      })
    }
    // parentLifetime is being disposed — its children array is about to be
    // cleared by the recursive dispose pass, so skip per-entry parent
    // removal (avoids O(N²) indexOf+splice).
    //
    // Rows created AFTER the parent's initial render (each reconciled
    // with a new item list) are siblings of the anchor inside the
    // parent's DOM container, but aren't tracked by the parent's
    // snapshot (e.g. an outer branch's currentNodes). Walking entries
    // here and removing their DOM — guarded by parentNode — closes
    // the leak: cascade-removed subtrees no-op, live-parent cases get
    // the orphans cleaned up.
    for (const entry of entries) {
      for (const node of entry.nodes) {
        if (node.parentNode) node.parentNode.removeChild(node)
      }
      disposeLifetime(entry.scope, true)
    }
    entries.length = 0
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor)
    if (endAnchor.parentNode) endAnchor.parentNode.removeChild(endAnchor)
    // Force-remove any mid-leave entries immediately
    for (const entry of leaving) {
      for (const node of entry.nodes) {
        if (node.parentNode) node.parentNode.removeChild(node)
      }
      disposeLifetime(entry.scope, true)
    }
    leaving.length = 0
  })

  const result: Node[] = [anchor]
  for (const entry of entries) {
    const nodes = entry.nodes
    for (let i = 0; i < nodes.length; i++) result.push(nodes[i]!)
  }
  result.push(endAnchor)
  return result
}

/**
 * Remove an entry's DOM + dispose its scope, running opts.leave first if
 * provided. When leave returns a Promise, the DOM removal is deferred until
 * resolution (entry is tracked in `leaving`).
 */
function removeEntry<T>(
  entry: Entry<T>,
  opts: { leave?: (nodes: Node[]) => void | Promise<void> },
  leaving: Entry<T>[],
): void {
  const removeNow = (): void => {
    for (const node of entry.nodes) {
      if (node.parentNode) node.parentNode.removeChild(node)
    }
    if (import.meta.env?.DEV) entry.scope.disposalCause = 'each-remove'
    disposeLifetime(entry.scope)
    const idx = leaving.indexOf(entry)
    if (idx !== -1) leaving.splice(idx, 1)
  }
  // Build-flag-gated leave animation. When `__LLUI_TRANSITIONS__` is
  // false the whole block dead-code-eliminates and `removeEntry`
  // collapses to its `removeNow()` call.
  if (
    typeof __LLUI_TRANSITIONS__ !== 'undefined' &&
    __LLUI_TRANSITIONS__ &&
    opts.leave &&
    entry.nodes.length > 0
  ) {
    const result = opts.leave(entry.nodes)
    if (result && typeof (result as Promise<void>).then === 'function') {
      leaving.push(entry)
      ;(result as Promise<void>).then(removeNow)
      return
    }
  }
  removeNow()
}

function fireEnter<T>(
  entry: Entry<T>,
  opts: { enter?: (nodes: Node[]) => void | Promise<void> },
): void {
  // Build-flag-gated enter animation. `fireEnter` collapses to a no-op
  // function when `__LLUI_TRANSITIONS__` is false; terser then inlines
  // and drops the callers' calls.
  if (
    typeof __LLUI_TRANSITIONS__ !== 'undefined' &&
    __LLUI_TRANSITIONS__ &&
    opts.enter &&
    entry.nodes.length > 0
  ) {
    void opts.enter(entry.nodes)
  }
}

function buildEntry<S, T, M>(
  item: T,
  index: number,
  opts: EachOptions<S, T, M>,
  parentLifetime: Lifetime,
  ctx: RenderContext,
  state?: unknown,
): Entry<T> {
  const key = callKey(opts, item)
  // Use a lightweight scope — just needs itemUpdaters for per-item bindings.
  // Full scope features (disposers, bindings, children) are only needed when
  // the render callback uses structural primitives or selector.bind().
  const scope = createLifetime(parentLifetime)
  if (import.meta.env?.DEV) scope._kind = 'each'
  const currentState = (state ?? ctx.state) as S
  const send = ctx.send as (msg: M) => void

  // Create entry before render so itemAccessor closures can capture it
  const entry: Entry<T> = { key, item, current: item, index, scope, nodes: null!, updaters: [] }

  // Base callable: item(selector) for computed expressions
  const itemFn = <R>(selector: (t: T) => R): (() => R) => {
    const accessor = () => selector(entry.current)
    accessor.__perItem = true as const
    return accessor
  }

  // Proxy for item.field shorthand: LAZILY created. Compiled code uses
  // `acc(fn)` instead (the compiler rewrites item.x → acc(r => r.x)),
  // so the Proxy is never constructed in the common case. This saves
  // ~300ns × N Proxy allocations per create cycle.
  let itemProxy: ItemAccessor<T> | null = null
  const getItemProxy = (): ItemAccessor<T> => {
    if (itemProxy) return itemProxy
    let fieldCache: Map<string, () => unknown> | null = null
    itemProxy = new Proxy(itemFn as object, {
      get(target, prop) {
        if (typeof prop === 'symbol' || prop === 'then' || prop === 'prototype') {
          return Reflect.get(target, prop)
        }
        const key = prop as string
        if (fieldCache) {
          const cached = fieldCache.get(key)
          if (cached) return cached
        } else {
          fieldCache = new Map()
        }
        // `current` returns the whole item — essential for primitive T
        // (where the field map is useless) and for whole-record sampling.
        // Caller must call it like a method: `item.current()`.
        const accessor =
          key === 'current'
            ? () => entry.current
            : () => (entry.current as Record<string, unknown>)[key]
        ;(accessor as unknown as { __perItem: true }).__perItem = true
        fieldCache.set(key, accessor)
        return accessor
      },
    }) as ItemAccessor<T>
    return itemProxy
  }

  const indexAccessor = (): number => entry.index

  // Reuse a single context object to avoid allocation per entry. Every
  // non-rootLifetime/non-state field is copied from the surrounding
  // context — including `send` and `container`, which were dropped by
  // earlier versions. Missing `send` silently broke `child({ onMsg })`
  // bubble-up from inside an each() row (child.ts reads `parentCtx.send`,
  // got `undefined`, and skipped the bubble). Missing `container` made
  // `onMount(cb)` fall back to `document.body` instead of the parent
  // component's container.
  //
  // Snapshot every mutable singleton field before writing — restore
  // at the end. When an outer each's buildEntry calls render and
  // render constructs an inner each() whose own buildEntry recurses
  // through this same path, `ctx === buildCtx` (the shared
  // module-level singleton); `buildBag` is the same kind of shared
  // singleton. Without the save/restore, the inner's mutations leak
  // back into outer's render frame:
  //
  //   - `buildCtx.rootLifetime` drives binding / disposer ownership
  //     for every element helper called from outer render. Leaked,
  //     it attaches outer's later bindings to the inner entry's
  //     scope; the inner each's next reconcile (key change →
  //     dispose old entry) silently kills them.
  //
  //   - `buildCtx.state` is the fallback state when a buildEntry is
  //     called without an explicit `state` arg. Leaked, it leaves
  //     reconcile-time buildEntries seeing the wrong snapshot.
  //
  //   - `buildBag._getItemProxy` is what the `get item()` getter
  //     invokes on every `bag.item` read. Render that destructures
  //     `{ item }` at the top captures outer's proxy correctly, but
  //     render that accesses `bag.item` lazily AFTER a nested each
  //     would see the inner's proxy. Other `buildBag` fields (send,
  //     acc, index, entry, h) are similarly read on every access.
  //
  // The inst-level fields copied into buildCtx below (allBindings,
  // structuralBlocks, dom, instance, send, container) are invariants
  // across the component's lifetime — they're set the same in every
  // buildEntry call, so leaking them is a no-op.
  //
  // Regression coverage: test/nested-each-trailing-binding.test.ts.
  const prevRootLifetime = buildCtx.rootLifetime
  const prevState = buildCtx.state
  const prevBagSend = buildBag.send
  const prevBagAcc = buildBag.acc
  const prevBagIndex = buildBag.index
  const prevBagGetItemProxy = buildBag._getItemProxy
  const prevBagEntry = (buildBag as Record<string, unknown>).entry
  const prevBagH = (buildBag as Record<string, unknown>).h
  const prevBagTpl = (buildBag as Record<string, unknown>).__tpl
  const prevBagRowUpd = (buildBag as Record<string, unknown>).__rowUpd
  buildCtx.rootLifetime = scope
  buildCtx.state = currentState
  buildCtx.allBindings = ctx.allBindings
  buildCtx.structuralBlocks = ctx.structuralBlocks
  buildCtx.dom = ctx.dom
  buildCtx.instance = ctx.instance
  buildCtx.send = ctx.send
  buildCtx.container = ctx.container
  const prevFlatBindings = getFlatBindings()
  setFlatBindings(ctx.allBindings)
  setRenderContext(buildCtx)

  // Reuse a single render bag object across entries — mutate `acc` and
  // `index` per entry to avoid per-entry object allocation.
  buildBag.send = send
  buildBag.acc = itemFn
  buildBag.index = indexAccessor
  buildBag._getItemProxy = getItemProxy
  buildBag.entry = entry
  // The View bag — lets each.render use `h.text`, `h.scope`, `h.sample`,
  // etc. without reaching for the top-level imports. Each entry gets a
  // fresh View so its `send` is bound to this row's dispatch path.
  // v0.4 Tier 1.2 + cache follow-up: the bag is constructed once per
  // owning instance and reused for every row. Pre-cache: 1000 rows = 1000
  // bag allocations + 1000 __view calls. Post-cache: 1 per instance.
  // (Test-mode createView fallback is gated inside getInstanceViewBag.)
  buildBag.h = getInstanceViewBag<S, M>(ctx.instance, send) as View<S, M>
  // Row factory: pass compiler-injected template + update function through to render
  const rfOpts = opts as unknown as Record<string, unknown>
  if (rfOpts.__tpl) buildBag.__tpl = rfOpts.__tpl
  if (rfOpts.__rowUpd) buildBag.__rowUpd = rfOpts.__rowUpd
  entry.nodes = opts.render(buildBag as Parameters<typeof opts.render>[0])

  // Move itemUpdaters from scope to entry for direct access during updateEntry.
  // This avoids scope.itemUpdaters lookup overhead on every item update.
  if (scope.itemUpdaters.length > 0) {
    entry.updaters = scope.itemUpdaters
    scope.itemUpdaters = []
  }

  // Restore every snapshotted singleton field. When `ctx === buildCtx`
  // (nested each), `setRenderContext(ctx)` alone is a no-op against
  // the shared singleton and the inner's mutations would leak into
  // outer's remaining render. See the snapshot comment above for
  // which fields actually matter and why.
  buildCtx.rootLifetime = prevRootLifetime
  buildCtx.state = prevState
  buildBag.send = prevBagSend
  buildBag.acc = prevBagAcc
  buildBag.index = prevBagIndex
  buildBag._getItemProxy = prevBagGetItemProxy
  ;(buildBag as Record<string, unknown>).entry = prevBagEntry
  ;(buildBag as Record<string, unknown>).h = prevBagH
  ;(buildBag as Record<string, unknown>).__tpl = prevBagTpl
  ;(buildBag as Record<string, unknown>).__rowUpd = prevBagRowUpd
  clearRenderContext()
  setFlatBindings(prevFlatBindings)
  setRenderContext(ctx)

  return entry
}

interface TransitionReport {
  entering: Node[]
  leaving: Node[]
}

function collectNodes(target: Node[], nodes: Node[]): void {
  for (const n of nodes) target.push(n)
}

function reconcileEntries<S, T>(
  entries: Entry<T>[],
  newItems: T[],
  opts: EachOptions<S, T>,
  parentLifetime: Lifetime,
  parent: Node,
  anchor: Node,
  endAnchor: Node,
  ctx: RenderContext,
  state: unknown,
  leaving: Entry<T>[],
  report: TransitionReport | null,
): void {
  const oldLen = entries.length
  const newLen = newItems.length
  // Build-flag-gated: when `__LLUI_TRANSITIONS__` is false, `hasLeave`
  // folds to `false`, the report branch folds away, and `removeEntry`
  // collapses to synchronous removal. Per-item removal fast path
  // (lines below this) becomes unreachable.
  const hasLeave =
    typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && !!opts.leave

  // Fast path 1: clear all — bulk DOM removal.
  // When opts.leave is set, each item needs its own leave animation, so
  // fall through to per-item removal instead of Range.deleteContents().
  if (newLen === 0) {
    if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report) {
      for (const entry of entries) collectNodes(report.leaving, entry.nodes)
    }
    if (hasLeave) {
      const toRemove = entries.slice()
      entries.length = 0
      for (const entry of toRemove) removeEntry(entry, opts, leaving)
      return
    }
    // Remove all DOM nodes in one operation using Range. Anchored on
    // start + end sentinels — see endAnchor comment in each() for why.
    if (entries.length > 0) {
      const range = ctx.dom.createRange()
      range.setStartAfter(anchor)
      range.setEndBefore(endAnchor)
      range.deleteContents()
    }
    // Bulk dispose all entry scopes — avoids per-scope function call overhead
    const scopes: Lifetime[] = []
    for (let i = 0; i < entries.length; i++) {
      const s = entries[i]!.scope
      if (import.meta.env?.DEV) s.disposalCause = 'each-remove'
      scopes.push(s)
    }
    disposeLifetimesBulk(scopes)
    removeOrphanedChildren(parentLifetime)
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
    const frag = ctx.dom.createDocumentFragment()
    const newlyAdded: Entry<T>[] = []
    for (let i = oldLen; i < newLen; i++) {
      const entry = buildEntry(newItems[i]!, i, opts, parentLifetime, ctx, state)
      entries.push(entry)
      newlyAdded.push(entry)
      for (const node of entry.nodes) frag.appendChild(node)
    }
    parent.insertBefore(frag, ref)
    if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report) {
      for (const entry of newlyAdded) collectNodes(report.entering, entry.nodes)
    }
    for (const entry of newlyAdded) fireEnter(entry, opts)
    return
  }

  // Fast path 3: same length — single pass handles both same-keys update
  // and two-element swap detection. Avoids a second O(n) pass.
  if (newLen === oldLen) {
    let mismatch1 = -1
    let mismatch2 = -1
    let mismatchCount = 0

    for (let i = 0; i < newLen; i++) {
      const entry = entries[i]!
      const newItem = newItems[i]!
      if (entry.item === newItem) continue
      const newKey = callKey(opts, newItem)
      if (entry.key === newKey) {
        updateEntry(entry, newItem, i)
        continue
      }
      // Key mismatch — track for swap detection
      mismatchCount++
      if (mismatchCount === 1) mismatch1 = i
      else if (mismatchCount === 2) mismatch2 = i
      else break // 3+ mismatches → fall through to general path
    }

    // All keys matched (with possible item updates) → done
    if (mismatchCount === 0) return

    // Exactly 2 key mismatches — check if it's a swap
    if (mismatchCount === 2) {
      const e1 = entries[mismatch1]!
      const e2 = entries[mismatch2]!
      if (
        e1.key === callKey(opts, newItems[mismatch2]!) &&
        e2.key === callKey(opts, newItems[mismatch1]!)
      ) {
        // DOM swap
        const refI = e1.nodes[0]!
        const refAfterJ = e2.nodes[e2.nodes.length - 1]!.nextSibling
        for (const node of e2.nodes) parent.insertBefore(node, refI)
        for (const node of e1.nodes) parent.insertBefore(node, refAfterJ)
        entries[mismatch1] = e2
        entries[mismatch2] = e1
        updateEntry(e2, newItems[mismatch1]!, mismatch1)
        updateEntry(e1, newItems[mismatch2]!, mismatch2)
        return
      }
    }
    // Fall through to general path for 3+ mismatches or non-swap
  }

  // Fast path 5: full replace — no shared keys between old and new.
  // Skipped when opts.leave is set so departing items can animate individually.
  if (!hasLeave && oldLen > 0 && callKey(opts, newItems[0]!) !== entries[0]!.key) {
    const oldKeys = new Set<string | number>()
    for (const entry of entries) oldKeys.add(entry.key)
    let anyShared = false
    for (let i = 0; i < newLen; i++) {
      if (oldKeys.has(callKey(opts, newItems[i]!))) {
        anyShared = true
        break
      }
    }
    if (!anyShared) {
      if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report) {
        for (const entry of entries) collectNodes(report.leaving, entry.nodes)
      }
      // Bulk DOM removal using Range — anchored on this each's stable
      // sentinels so a stale lastEntry node from a nested-primitive
      // mutation can't trip setEndAfter.
      const range = ctx.dom.createRange()
      range.setStartAfter(anchor)
      range.setEndBefore(endAnchor)
      range.deleteContents()
      // Bulk dispose all old scopes
      const oldLifetimes: Lifetime[] = []
      for (let i = 0; i < entries.length; i++) {
        const s = entries[i]!.scope
        if (import.meta.env?.DEV) s.disposalCause = 'each-remove'
        oldLifetimes.push(s)
      }
      disposeLifetimesBulk(oldLifetimes)
      removeOrphanedChildren(parentLifetime)
      entries.length = 0
      // Build all new entries into a fragment
      const frag = ctx.dom.createDocumentFragment()
      const newlyAdded: Entry<T>[] = []
      for (let i = 0; i < newLen; i++) {
        const entry = buildEntry(newItems[i]!, i, opts, parentLifetime, ctx, state)
        entries.push(entry)
        newlyAdded.push(entry)
        for (const node of entry.nodes) frag.appendChild(node)
      }
      parent.insertBefore(frag, anchor.nextSibling)
      if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report) {
        for (const entry of newlyAdded) collectNodes(report.entering, entry.nodes)
      }
      for (const entry of newlyAdded) fireEnter(entry, opts)
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
  const newlyAdded: Entry<T>[] = []

  for (let i = 0; i < newLen; i++) {
    const item = newItems[i]!
    const key = callKey(opts, item)
    usedKeys.add(key)

    const existing = oldByKey.get(key)
    if (existing) {
      updateEntry(existing, item, i)
      newEntries.push(existing)
    } else {
      const entry = buildEntry(item, i, opts, parentLifetime, ctx, state)
      newEntries.push(entry)
      newlyAdded.push(entry)
    }
  }

  // Remove entries not in the new list. Use bulk-detach pattern so
  // disposing K removals costs O(K+P) rather than O(K*P) where P is
  // parentLifetime.children.length (avoids K * indexOf+splice).
  let didBulkDetach = false
  for (const entry of entries) {
    if (!usedKeys.has(entry.key)) {
      if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report)
        collectNodes(report.leaving, entry.nodes)
      if (hasLeave) {
        removeEntry(entry, opts, leaving)
      } else {
        // Defensive guard: a nested primitive (inner each / show / branch)
        // may have replaced its own captured nodes between the outer
        // render snapshot and now. Those replaced nodes are still in
        // entry.nodes but no longer children of `parent`. Skip them —
        // the inner-primitive's addDisposer cascade (run by the scope
        // disposal below) cleans up the orphan replacement nodes that
        // ARE attached. Without this guard, removeChild throws
        // NotFoundError on the stale ones.
        for (const node of entry.nodes) {
          if (node.parentNode === parent) parent.removeChild(node)
        }
        if (import.meta.env?.DEV) entry.scope.disposalCause = 'each-remove'
        disposeLifetime(entry.scope, true)
        didBulkDetach = true
      }
    }
  }
  if (didBulkDetach) removeOrphanedChildren(parentLifetime)

  // Reorder DOM
  const hasSurvivors = newEntries.some((e) => oldByKey.has(e.key))

  if (!hasSurvivors || !survivorsInOrder(entries, newEntries, usedKeys)) {
    // Full fragment rebuild — one reflow
    const frag = ctx.dom.createDocumentFragment()
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
        if (frag) {
          parent.insertBefore(frag, insertRef)
          frag = null
        }
        // Skip past survivor's nodes
        const lastNode = entry.nodes[entry.nodes.length - 1]
        insertRef = lastNode ? lastNode.nextSibling : insertRef
      } else {
        // Batch new entries into a fragment
        if (!frag) frag = ctx.dom.createDocumentFragment()
        for (const node of entry.nodes) frag.appendChild(node)
      }
    }
    if (frag) parent.insertBefore(frag, insertRef)
  }

  entries.length = newEntries.length
  for (let i = 0; i < newEntries.length; i++) entries[i] = newEntries[i]!

  if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && report) {
    for (const entry of newlyAdded) collectNodes(report.entering, entry.nodes)
  }

  // Fire enter for newly-added entries (after DOM insertion). Gated
  // by `__LLUI_TRANSITIONS__` build flag — bench-shape apps skip
  // the whole branch.
  if (typeof __LLUI_TRANSITIONS__ !== 'undefined' && __LLUI_TRANSITIONS__ && opts.enter) {
    for (const entry of newlyAdded) fireEnter(entry, opts)
  }
}

function updateEntry<T>(entry: Entry<T>, item: T, index: number): void {
  const changed = !Object.is(entry.item, item)
  entry.item = item
  entry.current = item
  entry.index = index
  // eachItemStable removed — unused
  // Directly run per-item updaters when item changed — bypasses Phase 2
  if (changed) {
    // Row factory fast path: shared update function, zero closures
    const rowUpd = (entry as unknown as Record<string, unknown>).__rowUpdate as
      | ((e: Entry<T>) => void)
      | undefined
    if (rowUpd) {
      rowUpd(entry)
    } else {
      // Closure-based fallback
      const updaters = entry.updaters.length > 0 ? entry.updaters : entry.scope.itemUpdaters
      for (let i = 0; i < updaters.length; i++) {
        updaters[i]!()
      }
    }
  }
}

function isAppendOnly<S, T>(entries: Entry<T>[], newItems: T[], opts: EachOptions<S, T>): boolean {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.key !== callKey(opts, newItems[i]!)) return false
  }
  return true
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
