import type { Lifetime, Binding } from './types.js'
import type { StructuralBlock } from './structural.js'
import type { ComponentInstance } from './update-loop.js'

export interface RenderContext {
  rootLifetime: Lifetime
  state: unknown
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  container?: Element
  send?: (msg: unknown) => void
  /** @internal dev-only — the owning ComponentInstance. Set by mount /
   *  hydrate / child to let primitives (currently `each`) emit tracker
   *  data to `inst._eachDiffLog`. Nested contexts pass through via
   *  spread (e.g. `{ ...ctx, rootLifetime }`). Undefined outside dev. */
  instance?: ComponentInstance
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
        `It was called outside a render context. Common causes:\n` +
        `  1. Calling a primitive at module scope instead of inside view().\n` +
        `  2. Calling an overlay helper (dialog.overlay, popover.overlay, …) at ` +
        `module scope — these internally use show()/branch() and must be invoked ` +
        `from inside the component's view callback so their result can be spread ` +
        `into the returned node tree.\n` +
        `  3. Calling a primitive from a setTimeout / Promise / event handler — ` +
        `the render context only persists during the synchronous view() call.`,
    )
  }
  return currentContext
}
