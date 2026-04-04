import type { BranchOptions, Scope } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope, addDisposer } from '../scope'
import { setFlatBindings } from '../binding'
import type { StructuralBlock } from '../structural'

export function branch<S, M = unknown>(opts: BranchOptions<S, M>): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope
  const blocks = ctx.structuralBlocks
  const send = ctx.send as (msg: M) => void

  const anchor = document.createComment('branch')

  let currentKey = opts.on(ctx.state as S)
  let currentScope: Scope | null = null
  let currentNodes: Node[] = []

  const caseKey = String(currentKey)
  const builder = opts.cases[caseKey]
  if (builder) {
    currentScope = createScope(parentScope)
    setRenderContext({ ...ctx, rootScope: currentScope })
    currentNodes = builder(ctx.state as S, send)
    clearRenderContext()
    setRenderContext(ctx)

    // Fire enter on initial mount
    if (opts.enter && currentNodes.length > 0) {
      opts.enter(currentNodes)
    }
  }

  const block: StructuralBlock = {
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
      if (newBuilder) {
        currentScope = createScope(parentScope)
        setFlatBindings(ctx.allBindings, ctx.bindingsByBit)
        setRenderContext({ ...ctx, rootScope: currentScope, state })
        currentNodes = newBuilder(state as S, send)
        clearRenderContext()
        setFlatBindings(null, null)

        const ref = anchor.nextSibling
        for (const node of currentNodes) {
          parent.insertBefore(node, ref)
        }
      }

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
          (result as Promise<void>).then(removeOld)
        } else {
          removeOld()
        }
      } else {
        removeOld()
      }
    },
  }

  blocks.push(block)

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
