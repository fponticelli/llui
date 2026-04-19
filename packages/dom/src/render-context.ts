import type { Lifetime, Binding } from './types.js'
import type { StructuralBlock } from './structural.js'
import type { ComponentInstance } from './update-loop.js'
import type { DomEnv } from './dom-env.js'

export interface RenderContext {
  rootLifetime: Lifetime
  state: unknown
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  container?: Element
  send?: (msg: unknown) => void
  /**
   * The DOM implementation backing this render pass. Seeded by
   * `mountApp` / `hydrateApp` / `renderToString` and threaded through
   * every nested primitive via context spread. Primitives construct
   * DOM through `ctx.dom.createElement(...)` etc. instead of reaching
   * for `globalThis.document`.
   */
  dom: DomEnv
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
    // `sample()` is specifically the one users reach for from adapter
    // send wrappers / event handlers / async callbacks expecting it to
    // be "imperative and safe." It isn't — it's a view-primitive that
    // reads the render-time state snapshot, and the context is cleared
    // as soon as view() returns. Point at the sanctioned escape hatch
    // in the thrown message so the caller doesn't have to dig.
    const sampleGuidance =
      primitiveName === 'sample'
        ? '\n\nFor the "read state inside a callback / handler" case: use ' +
          'AppHandle.getState() instead. It is safe to call from anywhere ' +
          '(event handlers, adapter send wrappers, async callbacks, timers).\n' +
          'Example:\n' +
          '  const handle = mountApp(root, App)\n' +
          "  el.addEventListener('click', () => {\n" +
          '    const { count } = handle.getState() as AppState\n' +
          "    if (count > 0) handle.send({ type: 'tick' })\n" +
          '  })'
        : ''
    throw new Error(
      `[LLui] ${name} can only be called inside a component's view() function. ` +
        `It was called outside a render context. Common causes:\n` +
        `  1. Calling a primitive at module scope instead of inside view().\n` +
        `  2. Calling an overlay helper (dialog.overlay, popover.overlay, …) at ` +
        `module scope — these internally use show()/branch() and must be invoked ` +
        `from inside the component's view callback so their result can be spread ` +
        `into the returned node tree.\n` +
        `  3. Calling a primitive from a setTimeout / Promise / event handler — ` +
        `the render context only persists during the synchronous view() call.` +
        sampleGuidance,
    )
  }
  return currentContext
}
