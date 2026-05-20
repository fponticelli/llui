// Re-export of `@llui/dom`'s internal test-component builder. v2b §6.
//
// Consumers of `@llui/test` use this to construct `ComponentDef`s that
// opt into the optimized runtime path (stamped with the `'__test__'`
// sentinel `__compilerVersion`, so `assertCompilerCompatibility`
// short-circuits and `warnUncompiledOnce` does not fire).
//
// The single source of truth lives in
// `packages/dom/src/internal/test-component-builder.ts`. `@llui/dom`
// re-exports it through `@llui/dom/internal`; we re-export it again
// here so consumers reach for a public surface and never touch
// `@llui/dom`'s internal namespace directly.

export { defineTestComponent, type DefineTestComponentInput } from '@llui/dom/internal'
