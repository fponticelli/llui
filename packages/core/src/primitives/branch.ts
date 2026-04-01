import type { BranchOptions, Scope } from '../types'
import { getRenderContext } from '../render-context'
import { setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import { registerStructuralBlock, removeStructuralBlock } from '../structural'
import type { StructuralBlock } from '../structural'

export function branch<S>(opts: BranchOptions<S>): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope

  // Comment node as a stable anchor in the DOM
  const anchor = document.createComment('branch')

  // Evaluate initial discriminant
  let currentKey = opts.on(ctx.state as S)
  let currentScope: Scope | null = null
  let currentNodes: Node[] = []

  // Build the initial case
  const caseKey = String(currentKey)
  const builder = opts.cases[caseKey]
  if (builder) {
    currentScope = createScope(parentScope)
    const savedCtx = { rootScope: currentScope, state: ctx.state }
    setRenderContext(savedCtx)
    currentNodes = builder()
    clearRenderContext()
    // Restore the parent context
    setRenderContext(ctx)
  }

  const block: StructuralBlock = {
    reconcile(state: unknown, _dirtyMask: number) {
      const newKey = opts.on(state as S)
      if (Object.is(newKey, currentKey)) return

      const parent = anchor.parentNode
      if (!parent) return

      // Remove old nodes and dispose old scope
      for (const node of currentNodes) {
        parent.removeChild(node)
      }
      if (currentScope) {
        disposeScope(currentScope)
        currentScope = null
      }
      currentNodes = []
      currentKey = newKey

      // Build new case
      const newCaseKey = String(newKey)
      const newBuilder = opts.cases[newCaseKey]
      if (newBuilder) {
        currentScope = createScope(parentScope)
        const buildCtx = { rootScope: currentScope, state }
        setRenderContext(buildCtx)
        currentNodes = newBuilder()
        clearRenderContext()

        // Insert new nodes after the anchor
        const ref = anchor.nextSibling
        for (const node of currentNodes) {
          parent.insertBefore(node, ref)
        }
      }
    },
  }

  registerStructuralBlock(block)

  // Register a disposer on the parent scope to clean up the structural block
  parentScope.disposers.push(() => {
    removeStructuralBlock(block)
    if (currentScope) {
      disposeScope(currentScope)
      currentScope = null
    }
  })

  // Return anchor + initial nodes
  return [anchor, ...currentNodes]
}
