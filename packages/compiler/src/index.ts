// @llui/compiler — engine. Adapters consume through these re-exports.
// Migration in progress (see docs/proposals/v2-compiler/v2a.md §4.4).
export * from './accessor-resolver.js'
export * from './binding-descriptors.js'
export * from './collect-deps.js'
export * from './compiler-cache.js'
export * from './cross-file-resolver.js'
export * from './cross-file-walker.js'
export * from './diagnostic.js'
export * from './manifest.js'
export * from './module.js'
export * from './version.js'
export { reactivePathsModule } from './modules/reactive-paths.js'
export {
  schemaHashModule,
  SCHEMA_HASH_INPUTS_SLOT,
  type SchemaHashInputs,
} from './modules/schema-hash.js'
export { componentMetaModule } from './modules/component-meta.js'
export * from './msg-annotations.js'
export * from './msg-schema.js'
export * from './schema-hash.js'
export * from './state-schema.js'
export * from './transform.js'
