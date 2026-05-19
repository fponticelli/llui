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
export { maskLegendModule, type MaskLegendModuleOptions } from './modules/mask-legend.js'
export { compilerStampModule } from './modules/compiler-stamp.js'
export {
  eachMemoModule,
  EACH_MEMO_SLOT,
  type EachMemoModuleOptions,
  type EachMemoSlot,
} from './modules/each-memo.js'
export {
  structuralMaskModule,
  type StructuralMaskModuleOptions,
} from './modules/structural-mask.js'
export { textMaskModule, type TextMaskModuleOptions } from './modules/text-mask.js'
export { itemDedupModule, type ItemDedupModuleOptions } from './modules/item-dedup.js'
export {
  elementRewriteModule,
  ELEMENT_REWRITE_SLOT,
  type ElementRewriteModuleOptions,
  type ElementRewriteSlot,
} from './modules/element-rewrite.js'
export { rowFactoryModule, type RowFactoryModuleOptions } from './modules/row-factory.js'
export {
  coreSynthesisModule,
  CORE_SYNTHESIS_SLOT,
  type CoreSynthesisModuleOptions,
  type CoreSynthesisSlot,
} from './modules/core-synthesis.js'
export * from './msg-annotations.js'
export * from './msg-schema.js'
export * from './schema-hash.js'
export * from './state-schema.js'
export * from './transform.js'
