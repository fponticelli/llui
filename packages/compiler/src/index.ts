// @llui/compiler — engine. Adapters consume through these re-exports.
// Migration in progress (see docs/proposals/v2-compiler/v2a.md §4.4).
export * from './emit-names.js'
export * from './accessor-resolver.js'
export * from './binding-descriptors.js'
export * from './collect-deps.js'
export * from './compiler-cache.js'
export * from './cross-file-resolver.js'
export * from './cross-file-walker.js'
export * from './diagnostic.js'
export * from './manifest.js'
export * from './manifest-io.js'
export * from './manifest-resolve.js'
export * from './build-manifest.js'
export { transformSignalComponentSource } from './signals/transform-component.js'
export { type LowerBail } from './signals/transform-view.js'
export {
  lintSignalSource,
  applyLintFixes,
  type SignalLintMessage,
  type SignalDiagnostic,
  type LintFix,
  type LintEdit,
} from './signals/rules.js'
export * from './module.js'
export * from './version.js'
export * from './introspection-factory.js'
export { findComponentCalls } from './modules/_shared.js'
// Introspection modules (schemaHashModule, msg-schema, msg-annotations,
// state-schema, binding-descriptors) moved to @llui/compiler-introspection
// in v2c/decomp-26. Adapters that previously imported these names from
// @llui/compiler must now import from @llui/compiler-introspection.
// BINDING_DESCRIPTORS_SLOT is re-exported from introspection-factory.js
// (above) so the orchestrator can read the slot without depending on
// the introspection package.
// componentMetaModule moved to @llui/compiler-devtools (v2c/decomp-27).
//
// The legacy 3-pass transform (`transform.ts`) and its emission modules
// (element-rewrite, core-synthesis, row-factory, item-dedup, text-mask,
// structural-mask, mask-legend, each-memo, compiler-stamp) plus the
// legacy lint runner (`lint-modules.ts`) were removed in the
// signal-runtime migration. Signal components compile via
// `transformSignalComponentSource` and lint via `lintSignalSource`
// (both re-exported above).
export * from './msg-annotations.js'
export * from './msg-schema.js'
export * from './schema-hash.js'
export * from './state-schema.js'
