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

// Accessor stack — tracks which structural-primitive or binding accessor is
// currently executing. `sample()` reads the top of this stack to detect calls
// from inside an accessor (forbidden — accessors must be pure functions of
// their parameter, since their reads drive mask gating).
//
// Implemented as an array (rather than a counter) so the targeted error can
// name the innermost accessor: "inside each().key" rather than just "inside
// an accessor". Nested primitives push/pop in LIFO order; the top is the
// site that called sample().
const accessorStack: string[] = []

export function enterAccessor(label: string): void {
  accessorStack.push(label)
}

export function exitAccessor(): void {
  accessorStack.pop()
}

export function currentAccessor(): string | null {
  const len = accessorStack.length
  return len > 0 ? accessorStack[len - 1]! : null
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
        `the render context only persists during the synchronous view() call.\n` +
        `  4. Calling a primitive from a structural accessor (each().key, ` +
        `each().items, branch().on, show().when, scope().on, …) or a ` +
        `binding accessor (text(s => …), el({attr: s => …})) during reconcile — ` +
        `accessors run during the update phase with no render context. They must ` +
        `be pure functions of their parameter; reads outside the parameter break ` +
        `mask gating.` +
        sampleGuidance,
    )
  }
  return currentContext
}
