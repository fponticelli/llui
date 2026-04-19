import type { BranchOptions, Lifetime } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createLifetime, disposeLifetime, addDisposer } from '../lifetime.js'
import { setFlatBindings } from '../binding.js'
import { createView } from '../view-helpers.js'
import { FULL_MASK } from '../update-loop.js'
import { pushMountQueue, popMountQueue, flushMountQueue } from './on-mount.js'
import type { StructuralBlock } from '../structural.js'

export function branch<S, M = unknown, K extends string = string>(
  opts: BranchOptions<S, M, K>,
): Node[] {
  const ctx = getRenderContext('branch')
  const parentLifetime = ctx.rootLifetime
  const blocks = ctx.structuralBlocks
  const send = ctx.send as (msg: M) => void

  const anchor = ctx.dom.createComment('branch')

  let currentKey = opts.on(ctx.state as S)
  let currentLifetime: Lifetime | null = null
  let currentNodes: Node[] = []

  const block: StructuralBlock = {
    mask: (opts as { __mask?: number }).__mask ?? FULL_MASK,
    reconcile(state: unknown) {
      const newKey = opts.on(state as S)
      if (Object.is(newKey, currentKey)) return

      const parent = anchor.parentNode
      if (!parent) return

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
        currentLifetime._kind =
          opts.__disposalCause === 'show-hide'
            ? 'show'
            : opts.__disposalCause === 'scope-rebuild'
              ? 'scope'
              : 'branch'
        setFlatBindings(ctx.allBindings)
        setRenderContext({ ...ctx, rootLifetime: currentLifetime, state })
        currentNodes = newBuilder(createView<S, M>(send))
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
    currentLifetime._kind =
      opts.__disposalCause === 'show-hide'
        ? 'show'
        : opts.__disposalCause === 'scope-rebuild'
          ? 'scope'
          : 'branch'
    setRenderContext({ ...ctx, rootLifetime: currentLifetime })
    currentNodes = builder(createView<S, M>(send))
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
    if (currentLifetime) {
      disposeLifetime(currentLifetime)
      currentLifetime = null
    }
  })

  return [anchor, ...currentNodes]
}
