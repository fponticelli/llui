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
  type SignalTransformOptions,
  type SignalTransformResult,
} from './signals/transform-component.js'
export { type LowerBail } from './signals/transform-view.js'
// Exported for the runtime-side drift gate: `@llui/dom`'s test suite asserts
// these mirrors still match its own `authoring.ts` exports. The gate MUST live
// there — `authoring.ts` is an input of `@llui/dom#test` but of no task in this
// package, so a compiler-side gate never reruns when the runtime adds a helper.
export {
  ELEMENT_HELPERS,
  SVG_ELEMENT_HELPERS,
  ALL_ELEMENT_HELPERS,
} from './signals/element-helpers.js'
export {
  lintSignalSource,
  lintAnnotationSyntaxSource,
  applyLintFixes,
  type SignalLintMessage,
  type SignalDiagnostic,
  type LintFix,
  type LintEdit,
} from './signals/rules.js'
export * from './version.js'
// Signal components compile via `transformSignalComponentSource` and lint
// via `lintSignalSource` (both re-exported above). Agent/devtools metadata
// (msg/effect/state schemas, msg annotations, schema hash, component meta —
// keyed by `COMPILER_META_KEYS`, see emit-names.ts) is emitted inline by that
// transform; the v2c module
// registry / factory system and the `@llui/compiler-{introspection,devtools}`
// packages that fed it were removed once the signal transform superseded
// the `transformLlui` orchestrator.
export * from './annotation-args.js'
export * from './msg-annotations.js'
export * from './msg-schema.js'
export * from './schema-hash.js'
export * from './state-schema.js'
