// @llui/compiler — engine. Adapters consume through these re-exports.
// Migration in progress (see docs/proposals/v2-compiler/v2a.md §4.4).
export * from './emit-names.js'
export * from './accessor-resolver.js'
export * from './binding-descriptors.js'
export * from './collect-deps.js'
export * from './cross-file-resolver.js'
export * from './diagnostic.js'
export * from './manifest.js'
export * from './manifest-io.js'
export * from './manifest-resolve.js'
export * from './build-manifest.js'
export {
  transformSignalComponentSource,
  transformSignalComponentSourceWithMap,
  type SignalTransformResult,
} from './signals/transform-component.js'
export { type LowerBail } from './signals/transform-view.js'
export {
  lintSignalSource,
  applyLintFixes,
  type SignalLintMessage,
  type SignalDiagnostic,
  type LintFix,
  type LintEdit,
} from './signals/rules.js'
export * from './version.js'
// Signal components compile via `transformSignalComponentSource` and lint
// via `lintSignalSource` (both re-exported above). Agent/devtools metadata
// (`__msgSchema`, `__msgAnnotations`, `__stateSchema`, `__schemaHash`,
// `__componentMeta`) is emitted inline by that transform; the v2c module
// registry / factory system and the `@llui/compiler-{introspection,devtools}`
// packages that fed it were removed once the signal transform superseded
// the `transformLlui` orchestrator.
export * from './msg-annotations.js'
export * from './msg-schema.js'
export * from './schema-hash.js'
export * from './state-schema.js'
