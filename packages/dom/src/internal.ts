/**
 * Internal primitives surface — exported for framework-adapter packages
 * (`@llui/vike`, `@llui/router`, `@llui/transitions`) that need to build
 * their own structural primitives on top of LLui's scope + render-context
 * machinery.
 *
 * **Not part of the public API.** App authors should not import from
 * `@llui/dom/internal`. The shapes here are free to change without a
 * major version bump — the stability contract applies only to the public
 * barrel at `@llui/dom`. Reach for this subpath when you're writing a
 * primitive like `pageSlot()` (from `@llui/vike`) that has to participate
 * in the scope tree, not when you're writing application views.
 *
 * Added in 0.0.16 to support `@llui/vike`'s persistent-layout feature.
 * Any future adapter-level primitive that needs render-context / scope
 * access should re-export from this file rather than duplicating the
 * low-level glue.
 */

export { getRenderContext, setRenderContext, clearRenderContext } from './render-context.js'
export type { RenderContext } from './render-context.js'
export { createScope, disposeScope, addDisposer } from './scope.js'
