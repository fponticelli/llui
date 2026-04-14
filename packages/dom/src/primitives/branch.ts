import type { BranchOptions, Scope } from '../types.js'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context.js'
import { createScope, disposeScope, addDisposer } from '../scope.js'
import { setFlatBindings } from '../binding.js'
import { createView } from '../view-helpers.js'
import { FULL_MASK } from '../update-loop.js'
import { pushMountQueue, popMountQueue, flushMountQueue } from './on-mount.js'
import type { StructuralBlock } from '../structural.js'

export function branch<S, M = unknown>(opts: BranchOptions<S, M>): Node[] {
  const ctx = getRenderContext('branch')
  const parentScope = ctx.rootScope
  const blocks = ctx.structuralBlocks
  const send = ctx.send as (msg: M) => void

  const anchor = document.createComment('branch')

  let currentKey = opts.on(ctx.state as S)
  let currentScope: Scope | null = null
  let currentNodes: Node[] = []

  const block: StructuralBlock = {
    mask: (opts as { __mask?: number }).__mask ?? FULL_MASK,
    reconcile(state: unknown) {
      const newKey = opts.on(state as S)
      if (Object.is(newKey, currentKey)) return

      const parent = anchor.parentNode
      if (!parent) return

      const leavingNodes = currentNodes
      const leavingScope = currentScope

      // Build new arm first (before removing old — for FLIP animations)
      currentNodes = []
      currentScope = null
      currentKey = newKey

      const newCaseKey = String(newKey)
      const newBuilder = opts.cases[newCaseKey]
      // Collect onMount callbacks from the new case into a local queue,
      // then flush them SYNCHRONOUSLY after the new nodes are inserted.
      // Without this, onMount inside a branch case would see stale DOM
      // (nodes not yet attached) OR fall back to queueMicrotask and
      // race with synchronous event dispatches after the reconcile.
      let onMountQueue: Array<() => void> | null = null
      if (newBuilder) {
        const mq = pushMountQueue()
        onMountQueue = mq.queue
        currentScope = createScope(parentScope)
        setFlatBindings(ctx.allBindings)
        setRenderContext({ ...ctx, rootScope: currentScope, state })
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
        if (leavingScope) disposeScope(leavingScope)
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

  const caseKey = String(currentKey)
  const builder = opts.cases[caseKey]
  // Initial-mount onMount callbacks are handled by the outer mountApp
  // queue — we're still inside the first view() call. branch doesn't
  // insert into the DOM at this point (the anchor + initial children
  // are returned to the parent), so we don't need to flush here.
  if (builder) {
    currentScope = createScope(parentScope)
    setRenderContext({ ...ctx, rootScope: currentScope })
    currentNodes = builder(createView<S, M>(send))
    clearRenderContext()
    setRenderContext(ctx)

    // Fire enter on initial mount
    if (opts.enter && currentNodes.length > 0) {
      opts.enter(currentNodes)
    }
  }

  addDisposer(parentScope, () => {
    const idx = blocks.indexOf(block)
    if (idx !== -1) blocks.splice(idx, 1)
    if (currentScope) {
      disposeScope(currentScope)
      currentScope = null
    }
  })

  return [anchor, ...currentNodes]
}
