import type { Scope } from './types'

export interface RenderContext {
  rootScope: Scope
  state: unknown
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
    throw new Error(
      'NO_RENDER_CONTEXT: view primitives (text, branch, each, show, etc.) ' +
        'can only be called inside a view() function during mount.',
    )
  }
  return currentContext
}
