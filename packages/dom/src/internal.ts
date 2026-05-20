/**
 * Internal surface — exported for two consumer categories:
 *
 *  1. **Framework-adapter packages** (`@llui/vike`, `@llui/router`,
 *     `@llui/transitions`) that build their own structural primitives
 *     on top of LLui's scope + render-context machinery.
 *  2. **Compiler-emitted runtime helpers** that the LLui compiler
 *     synthesizes imports for: `__bindUncertain`, `__cloneStaticTemplate`,
 *     `__runPhase2`, `__handleMsg`, `__registerScopeVariants`,
 *     `__clientOnlyStub`. These are never written by hand — the compiler's
 *     `cleanupImports` pass inserts the import declaration into the
 *     transformed module.
 *
 * **Not part of the public API.** App authors should not import from
 * `@llui/dom/internal`. The shapes here are free to change without a
 * major version bump — the stability contract applies only to the public
 * barrel at `@llui/dom`.
 *
 * Why these helpers live on a subpath instead of the root barrel: when a
 * downstream Vite SSR build externalizes `@llui/dom`, the chunk retains
 * `import { __cloneStaticTemplate } from "@llui/dom"` and the vite-plugin's
 * post-bundle property-rename pass rewrites the identifier. The renamed
 * name (`$a` / `$b` / …) doesn't exist on the package's public export
 * surface, and rolldown fails with `MISSING_EXPORT`. Hosting the helpers
 * at `@llui/dom/internal` keeps the rename pass's regex (which only
 * matches `__`-prefixed identifiers) from rewriting any name that
 * appears in a public-surface import position. See issue #5 follow-up
 * (compiler emit hygiene, 0.3.x dom / 0.4.x compiler).
 */

export { getRenderContext, setRenderContext, clearRenderContext } from './render-context.js'
export type { RenderContext } from './render-context.js'
export { createLifetime, disposeLifetime, addDisposer } from './lifetime.js'
export {
  defineTestComponentInternal as defineTestComponent,
  stampTestVersion,
  type DefineTestComponentInput,
} from './internal/test-component-builder.js'

// Compiler-emitted runtime helpers. The compiler's `cleanupImports`
// pass inserts an `import { … } from '@llui/dom/internal'` declaration
// referencing whichever of these are used in the transformed file.
export { __bindUncertain } from './binding.js'
export { __cloneStaticTemplate } from './el-template.js'
export { _runPhase2 as __runPhase2, _handleMsg as __handleMsg } from './update-loop.js'
export { __registerScopeVariants } from './binding-descriptors.js'
export { __clientOnlyStub } from './primitives/client-only.js'
