import type { Lifetime, Binding, Send } from './types.js'
import type { StructuralBlock } from './structural.js'
import type { ComponentInstance } from './update-loop.js'
import type { DomEnv } from './dom-env.js'
import { createView } from './view-helpers.js'

declare global {
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

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

/**
 * Return the view bag for `inst`, caching it on the instance so the
 * per-row allocation that each.render / branch arms / lazy fallback /
 * client-only render / hmr replay / ssr render used to incur on every
 * call collapses to a single object literal per instance. Hot path on
 * jfb's Select benchmark — `pnpm bench` measured +31% without this
 * cache (each row's mount called `def.__view(send)` afresh).
 *
 * Cache key is the instance: `send` is identity-stable per instance,
 * so the bag's bound `send` is correct for every call site that
 * receives it. The cache invalidates implicitly on instance disposal.
 * In test mode (no compiler-emitted `__view`) we fall through to
 * `createView` per call — tests don't measure perf, and the
 * createView reference is gone from production via the Vite-time MODE
 * fold (see mount.ts buildViewBag for the same pattern).
 */
export function getInstanceViewBag<S, M>(
  inst: ComponentInstance | undefined,
  send: Send<M>,
): unknown {
  // No instance → only happens in test-mode fixtures that mount through
  // a stub render context. The createView reference below is dead in
  // production builds (Vite folds the MODE check to a constant).
  if (!inst) {
    if (import.meta.env?.MODE !== 'production') return createView<S, M>(send)
    return { send }
  }
  if (inst._viewBag !== undefined) return inst._viewBag
  const factory = (inst.def as unknown as { __view?: (s: Send<M>) => unknown }).__view
  let bag: unknown
  if (factory) {
    bag = factory(send)
  } else if (import.meta.env?.MODE !== 'production') {
    bag = createView<S, M>(send)
  } else {
    bag = { send }
  }
  inst._viewBag = bag
  return bag
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
