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

export function getRenderContext(): RenderContext {
  if (!currentContext) {
    throw new Error('LLUI: primitives can only be called inside view()')
  }
  return currentContext
}
