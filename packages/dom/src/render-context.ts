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
 *
 * When `__view` is missing, the decision tree:
 *   - real `__compilerVersion` set (i.e. not `__test__` and not absent)
 *     → the compile pipeline ran for this def but failed to emit a
 *     `__view` factory. That's a genuine misconfiguration; throw a
 *     focused error so the dev sees the cause rather than a confusing
 *     "bag.text is not a function" later.
 *   - `__compilerVersion` absent or `__test__` → hand-rolled def
 *     (e.g. a vitest fixture not transformed by @llui/vite-plugin).
 *     Fall back to `createView`.
 *
 * Bundle note: we cannot statically DCE `createView` because the
 * fallback path is reachable for any consumer that mounts a
 * hand-rolled def. A previous iteration gated this on
 * `import.meta.env?.DEV` to let terser drop `createView` in prod
 * bundles, but that produced a hard runtime crash for downstream
 * consumers running vitest without the LLui transform — vitest doesn't
 * transform `node_modules`, so `import.meta.env?.DEV` evaluated as
 * `undefined` and the throw fired even when the def was clearly
 * hand-rolled. The compiler-version gate is the right signal: only
 * compiled defs are required to carry `__view`.
 */
export function getInstanceViewBag<S, M>(
  inst: ComponentInstance | undefined,
  send: Send<M>,
): unknown {
  if (!inst) return createView<S, M>(send)
  if (inst._viewBag !== undefined) return inst._viewBag
  const factory = (inst.def as unknown as { __view?: (s: Send<M>) => unknown }).__view
  let bag: unknown
  if (factory) {
    bag = factory(send)
  } else {
    const ver = (inst.def as unknown as { __compilerVersion?: string }).__compilerVersion
    if (ver !== undefined && ver !== '__test__') {
      throw new Error(
        `[LLui] component "${inst.def.name}" missing \`__view\` despite being compiled ` +
          `(compiler v${ver}) — your @llui/vite-plugin install may be out of date or the ` +
          `transform did not run on this file. Rebuild with the matching compiler version, ` +
          `or remove \`__compilerVersion\` from a hand-rolled def to opt into the runtime ` +
          `fallback.`,
      )
    }
    bag = createView<S, M>(send)
  }
  inst._viewBag = bag
  return bag
}

/**
 * BuildEntry recursion depth. Incremented by `enterBuildEntry()` at the
 * start of each `buildEntry` call (each.ts / virtual-each.ts) and
 * decremented by `exitBuildEntry()`. Used by `captureRenderContext` to
 * decide whether the live `currentContext` is the each-runtime's
 * shared `buildCtx` singleton (depth > 0 → must snapshot) or a
 * per-mount / per-component context (depth === 0 → safe to live-read).
 *
 * Module-level so a single counter spans every each/virtualEach in the
 * app. Reset to 0 across mounts is implicit: depth always returns to
 * its prior value via the matched enter/exit pair.
 */
let buildEntryDepth = 0

/** @internal — called by each/virtualEach at the start of buildEntry */
export function enterBuildEntry(): void {
  buildEntryDepth++
}

/** @internal — called by each/virtualEach at the end of buildEntry */
export function exitBuildEntry(): void {
  buildEntryDepth--
}

/** @internal — true when we're inside one or more buildEntry calls */
export function isInsideBuildEntry(): boolean {
  return buildEntryDepth > 0
}

/**
 * Capture the current render context as a stable reference. Returns the
 * live `currentContext` directly when we're at top level
 * (`buildEntryDepth === 0`); allocates a snapshot only when inside one
 * or more `buildEntry` calls, where the live context IS the each's
 * shared `buildCtx` singleton.
 *
 * Why a snapshot is needed inside buildEntry: when this primitive is
 * constructed inside another each's render, the live `currentContext`
 * IS the each-runtime's shared mutable `buildCtx` singleton. Any
 * subsequent buildEntry call (including ones triggered by an unrelated
 * sub-app's dispatch) reassigns fields on that singleton. Reading
 * `ctx.structuralBlocks` / `ctx.allBindings` at reconcile time then
 * returns whatever the singleton has been mutated to — not the values
 * that were live when this primitive was constructed. Symptom: nested
 * structural blocks register against the wrong instance and silently
 * freeze.
 *
 * Why live-read at top level is safe: mount.ts / hydrate.ts / each's
 * own block.reconcile create their RenderContext as a per-call object
 * (or per-mount object held only by the closure that constructed it)
 * — never the each module's shared singleton. So no aliasing risk.
 *
 * `getRenderContext` stays a live-read unconditionally for callers
 * that only use ctx synchronously during the call (most element
 * helpers + `text` / `sample` / `onMount`).
 */
export function captureRenderContext(primitiveName?: string): RenderContext {
  const live = getRenderContext(primitiveName)
  if (buildEntryDepth === 0) return live
  return {
    rootLifetime: live.rootLifetime,
    state: live.state,
    allBindings: live.allBindings,
    structuralBlocks: live.structuralBlocks,
    dom: live.dom,
    instance: live.instance,
    send: live.send,
    container: live.container,
  }
}

export function getRenderContext(primitiveName?: string): RenderContext {
  if (!currentContext) {
    const name = primitiveName ? `${primitiveName}()` : 'primitives'
    // Long-form guidance is dev-only — these are programming errors
    // (calling a primitive outside a view callback or inside an
    // accessor). Production apps that hit this still throw a brief
    // identifying error; the diagnostic prose adds ~600 source bytes
    // / ~250 bytes gz that the bundler keeps only when DEV is true.
    if (import.meta.env?.DEV) {
      // `sample()` is specifically the one users reach for from adapter
      // send wrappers / event handlers / async callbacks expecting it
      // to be "imperative and safe." It isn't — point at the sanctioned
      // escape hatch (`AppHandle.getState()`) so the caller doesn't
      // have to dig.
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
    throw new Error(`[LLui] ${name} called outside a render context`)
  }
  return currentContext
}
