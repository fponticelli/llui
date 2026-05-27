import type { BranchOptions, Lifetime } from '../types.js'
import {
  captureRenderContext,
  setRenderContext,
  clearRenderContext,
  enterAccessor,
  exitAccessor,
} from '../render-context.js'
import { createLifetime, disposeLifetime, addDisposer } from '../lifetime.js'
import { setFlatBindings } from '../binding.js'
import type { View } from '../view-helpers.js'
import { getInstanceViewBag } from '../render-context.js'
import type { ComponentInstance } from '../update-loop.js'

// v0.4 Tier 1.2 + cache follow-up: pulls a cached View bag from the
// owning instance (constructed once via `def.__view(send)`). Falls
// back to `createView(send)` when no `__view` was emitted — see
// getInstanceViewBag for the mode-agnostic fallback (issue #5).
function getOwnerBag<S, M>(
  ctx: { instance?: ComponentInstance | undefined },
  send: import('../types.js').Send<M>,
): View<S, M> {
  return getInstanceViewBag<S, M>(ctx.instance, send) as View<S, M>
}
import { FULL_MASK } from '../update-loop.js'
import { pushMountQueue, popMountQueue, flushMountQueue } from './on-mount.js'
import type { StructuralBlock } from '../structural.js'

export function branch<S, M = unknown, K extends string = string>(
  opts: BranchOptions<S, M, K>,
): Node[] {
  // Stable snapshot — branch's `block.reconcile` reads ctx.allBindings,
  // ctx.instance, ctx.send, ctx.dom at reconcile time and spreads
  // `{...ctx, rootLifetime, state}` into the new arm's render context.
  // Pre-snapshot, those reads sampled the shared `buildCtx` singleton
  // live; an intervening sub-app buildEntry would have repointed its
  // fields. See `captureRenderContext` for the rationale.
  const ctx = captureRenderContext('branch')
  const parentLifetime = ctx.rootLifetime
  const blocks = ctx.structuralBlocks
  const send = ctx.send as (msg: M) => void

  const anchor = ctx.dom.createComment('branch')

  // `on` accessor wrapped so sample()/h.sample() called from inside throws a
  // targeted error. Both initial and reconcile paths route through callOn.
  // `Discriminant<S, K>` is `((s: S) => K) | (() => K)` — passing `state`
  // works for either arm at runtime (zero-arg ignores the extra), but a
  // typed wrapper forces a union-call inference TypeScript can't unify.
  // The runtime cast keeps the wrapper transparent.
  const callOn = (state: S) => {
    enterAccessor('branch().on')
    try {
      return (opts.on as (s: S) => K)(state)
    } finally {
      exitAccessor()
    }
  }

  let currentKey = callOn(ctx.state as S)
  let currentLifetime: Lifetime | null = null
  let currentNodes: Node[] = []

  // Tracks the anchor's parent across reconciles, mirroring each.ts.
  // Lets `rebindParent` detect when an ancestor structural primitive
  // re-built its wrapper from a stale user-passed Node[] (Pattern 4)
  // — in that case only `anchor` moves to the new wrapper; the current
  // arm's nodes stay orphaned in the old detached wrapper.
  let lastParent: Node | null = null

  // When the compiler emitted `__mask` we trust both words it provided —
  // an absent `__maskHi` means "the driver reads only low-word fields,
  // skip high-word changes." When NO `__mask` is present (compile-time
  // analysis bailed, or the call was hand-rolled), both words must
  // default to FULL_MASK so the gate `(mask & dirty) | (maskHi & dirtyHi)`
  // doesn't silently drop changes in the word the compiler didn't speak
  // for. Asymmetric defaults (mask=FULL_MASK, maskHi=0) caused a
  // show/branch/each block to never reconcile when its driver field
  // lived at prefix index ≥ 31 — see issue write-up in CHANGELOG.
  const rawMask = (opts as { __mask?: number }).__mask
  const block: StructuralBlock = {
    mask: rawMask ?? FULL_MASK,
    maskHi: (opts as { __maskHi?: number }).__maskHi ?? (rawMask === undefined ? FULL_MASK : 0),
    reconcile(state: unknown) {
      const newKey = callOn(state as S)
      if (Object.is(newKey, currentKey)) return

      const parent = anchor.parentNode
      if (!parent) return

      // Arm swap is about to re-parent any nested structural primitives
      // whose Node[] was captured by user code at outer-view time (the
      // documented Pattern 4). After we insert the new arm, the runtime
      // runs a `rebindParent` pass over `inst.structuralBlocks` so each /
      // nested-branch blocks can re-attach drifted entries within the
      // same commit. See `each.ts::reattachDriftedEntries` for the
      // full bug write-up. Set the flag BEFORE building the new arm so
      // any throw inside the builder still triggers the rescan.
      if (ctx.instance) ctx.instance._postPhase1Rescan = true

      const leavingNodes = currentNodes
      const leavingLifetime = currentLifetime

      // Build new arm first (before removing old — for FLIP animations)
      currentNodes = []
      currentLifetime = null
      currentKey = newKey

      const newCaseKey = String(newKey) as K
      const newBuilder = opts.cases?.[newCaseKey] ?? opts.default
      // Collect onMount callbacks from the new case into a local queue,
      // then flush them SYNCHRONOUSLY after the new nodes are inserted.
      // Without this, onMount inside a branch case would see stale DOM
      // (nodes not yet attached) OR fall back to queueMicrotask and
      // race with synchronous event dispatches after the reconcile.
      let onMountQueue: Array<() => void> | null = null
      if (newBuilder) {
        const mq = pushMountQueue()
        onMountQueue = mq.queue
        currentLifetime = createLifetime(parentLifetime)
        if (import.meta.env?.DEV) {
          currentLifetime._kind =
            opts.__disposalCause === 'show-hide'
              ? 'show'
              : opts.__disposalCause === 'scope-rebuild'
                ? 'scope'
                : 'branch'
        }
        setFlatBindings(ctx.allBindings)
        setRenderContext({ ...ctx, rootLifetime: currentLifetime, state })
        currentNodes = newBuilder(getOwnerBag<S, M>(ctx, send))
        clearRenderContext()
        setFlatBindings(null)
        popMountQueue(mq.prev)

        const ref = anchor.nextSibling
        for (const node of currentNodes) {
          parent.insertBefore(node, ref)
        }
      }
      if (onMountQueue) flushMountQueue(onMountQueue)

      // Fire enter for new nodes
      if (opts.enter && currentNodes.length > 0) {
        opts.enter(currentNodes)
      }

      // Handle leave — may be deferred via Promise
      const removeOld = () => {
        for (const node of leavingNodes) {
          if (node.parentNode) node.parentNode.removeChild(node)
        }
        if (leavingLifetime) {
          // Tag BEFORE dispose so the disposer log records the cause.
          // `show()` passes `__disposalCause: 'show-hide'`; raw branch()
          // defaults to `'branch-swap'`. Tag wins over any pre-existing
          // value set by an inner primitive so the outermost cause is
          // reported (matches how humans describe the event).
          if (import.meta.env?.DEV)
            leavingLifetime.disposalCause = opts.__disposalCause ?? 'branch-swap'
          disposeLifetime(leavingLifetime)
        }
      }

      if (leavingNodes.length > 0 && opts.leave) {
        const result = opts.leave(leavingNodes)
        if (result && typeof (result as Promise<void>).then === 'function') {
          ;(result as Promise<void>).then(removeOld)
        } else {
          removeOld()
        }
      } else {
        removeOld()
      }
      lastParent = parent
    },

    /**
     * Self-heal hook — see `each.ts::rebindParent` for the full bug
     * write-up. When an ancestor primitive re-built its wrapper from a
     * stale Node[] (Pattern 4), only `anchor` moves into the new
     * wrapper; the current arm's nodes stay orphaned in the old
     * detached wrapper. Re-attach them between `anchor` and whatever
     * follows it (which becomes the insertion point for arm content).
     */
    rebindParent() {
      const parent = anchor.parentNode
      if (!parent) return
      if (parent === lastParent) return
      lastParent = parent
      if (currentNodes.length === 0) return
      // Drift check: first arm node already in `parent` → nothing to do.
      const firstNode = currentNodes[0]!
      const oldParent = firstNode.parentNode
      if (oldParent === parent || oldParent === null) return
      // Move the contiguous arm-content range (which may include nested
      // structural primitives' reconciled territory living between
      // currentNodes[0] and currentNodes[last]) into `parent` after the
      // anchor.
      const lastNode = currentNodes[currentNodes.length - 1]!
      const range = ctx.dom.createRange()
      range.setStartBefore(firstNode)
      range.setEndAfter(lastNode)
      const frag = range.extractContents()
      parent.insertBefore(frag, anchor.nextSibling)
    },
  }

  // Register the block BEFORE running the initial builder so that parent
  // blocks always precede their nested children in the flat blocks array.
  // This guarantees correct Phase 1 iteration order: parents reconcile
  // first, so a parent that unmounts its old arm can dispose nested child
  // blocks (splicing them out of this array) without corrupting the loop
  // index — the splice only affects entries to the RIGHT of the parent.
  blocks.push(block)

  const caseKey = String(currentKey) as K
  const builder = opts.cases?.[caseKey] ?? opts.default
  // Initial-mount onMount callbacks are handled by the outer mountApp
  // queue — we're still inside the first view() call. branch doesn't
  // insert into the DOM at this point (the anchor + initial children
  // are returned to the parent), so we don't need to flush here.
  if (builder) {
    currentLifetime = createLifetime(parentLifetime)
    if (import.meta.env?.DEV) {
      currentLifetime._kind =
        opts.__disposalCause === 'show-hide'
          ? 'show'
          : opts.__disposalCause === 'scope-rebuild'
            ? 'scope'
            : 'branch'
    }
    setRenderContext({ ...ctx, rootLifetime: currentLifetime })
    currentNodes = builder(getOwnerBag<S, M>(ctx, send))
    clearRenderContext()
    setRenderContext(ctx)

    // Fire enter on initial mount
    if (opts.enter && currentNodes.length > 0) {
      opts.enter(currentNodes)
    }
  }

  addDisposer(parentLifetime, () => {
    const idx = blocks.indexOf(block)
    if (idx !== -1) blocks.splice(idx, 1)
    // Remove arm DOM nodes + the anchor. The parent's own cleanup
    // (e.g. an outer branch's removeOld) only walks what its initial
    // render captured — nodes that THIS branch inserted into the
    // shared parent AFTER the outer's snapshot (including every
    // arm swap since initial mount) aren't in that list. Walking
    // `currentNodes` here and guarding with `parentNode` closes the
    // leak: if the parent DOM is already cascade-removed by an
    // ancestor, `node.parentNode` is null and the removeChild
    // no-ops. If the parent is still live (spread-into-arm case),
    // the removal is what cleans up the orphans.
    for (const node of currentNodes) {
      if (node.parentNode) node.parentNode.removeChild(node)
    }
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor)
    if (currentLifetime) {
      disposeLifetime(currentLifetime)
      currentLifetime = null
    }
  })

  return [anchor, ...currentNodes]
}
