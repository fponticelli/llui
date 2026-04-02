import type { BranchOptions, Scope } from '../types'
import { getRenderContext, setRenderContext, clearRenderContext } from '../render-context'
import { createScope, disposeScope } from '../scope'
import { setFlatBindings } from '../binding'
import type { StructuralBlock } from '../structural'

export function branch<S>(opts: BranchOptions<S>): Node[] {
  const ctx = getRenderContext()
  const parentScope = ctx.rootScope
  const blocks = ctx.structuralBlocks

  const anchor = document.createComment('branch')

  let currentKey = opts.on(ctx.state as S)
  let currentScope: Scope | null = null
  let currentNodes: Node[] = []

  const caseKey = String(currentKey)
  const builder = opts.cases[caseKey]
  if (builder) {
    currentScope = createScope(parentScope)
    setRenderContext({ ...ctx, rootScope: currentScope })
    currentNodes = builder()
    clearRenderContext()
    setRenderContext(ctx)
  }

  const block: StructuralBlock = {
    reconcile(state: unknown) {
      const newKey = opts.on(state as S)
      if (Object.is(newKey, currentKey)) return

      const parent = anchor.parentNode
      if (!parent) return

      for (const node of currentNodes) {
        parent.removeChild(node)
      }
      if (currentScope) {
        disposeScope(currentScope)
        currentScope = null
      }
      currentNodes = []
      currentKey = newKey

      const newCaseKey = String(newKey)
      const newBuilder = opts.cases[newCaseKey]
      if (newBuilder) {
        currentScope = createScope(parentScope)
        setFlatBindings(ctx.allBindings)
        setRenderContext({ ...ctx, rootScope: currentScope, state })
        currentNodes = newBuilder()
        clearRenderContext()
        setFlatBindings(null)

        const ref = anchor.nextSibling
        for (const node of currentNodes) {
          parent.insertBefore(node, ref)
        }
      }
    },
  }

  blocks.push(block)

  parentScope.disposers.push(() => {
    const idx = blocks.indexOf(block)
    if (idx !== -1) blocks.splice(idx, 1)
    if (currentScope) {
      disposeScope(currentScope)
      currentScope = null
    }
  })

  return [anchor, ...currentNodes]
}
