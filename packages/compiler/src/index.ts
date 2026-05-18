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
export {
  schemaHashModule,
  SCHEMA_HASH_INPUTS_SLOT,
  type SchemaHashInputs,
} from './modules/schema-hash.js'
export { componentMetaModule } from './modules/component-meta.js'
export { stateSchemaModule, type StateSchemaModuleOptions } from './modules/state-schema.js'
export {
  msgAnnotationsModule,
  type MsgAnnotationsModuleOptions,
} from './modules/msg-annotations.js'
export { msgSchemaModule, type MsgSchemaModuleOptions } from './modules/msg-schema.js'
export {
  bindingDescriptorsModule,
  BINDING_DESCRIPTORS_SLOT,
} from './modules/binding-descriptors.js'
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
