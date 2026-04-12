import type { Scope, Binding } from './types'
import type { StructuralBlock } from './structural'

export interface RenderContext {
  rootScope: Scope
  state: unknown
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  container?: Element
  send?: (msg: unknown) => void
}

let currentContext: RenderContext | null = null

export function setRenderContext(ctx: RenderContext): void {
  currentContext = ctx
}

export function clearRenderContext(): void {
  currentContext = null
}

export function getRenderContext(primitiveName?: string): RenderContext {
  if (!currentContext) {
    const name = primitiveName ? `${primitiveName}()` : 'primitives'
    throw new Error(
      `[LLui] ${name} can only be called inside a component's view() function. ` +
        `It was called outside a render context — ensure it runs synchronously within view(), ` +
        `not in a setTimeout, Promise, or event handler.`,
    )
  }
  return currentContext
}
