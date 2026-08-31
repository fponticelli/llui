export { add, type AddOptions, type AddResult } from './add.js'
export {
  CONFIG_FILE,
  ConfigSchema,
  DEFAULT_CONFIG,
  aliasKeyOf,
  readConfig,
  targetDir,
  writeConfig,
  type Config,
} from './config.js'
export { rewriteImports } from './rewrite.js'
export { formatProductList } from './product-list.js'
export {
  CopiedArtifactSchema,
  MachineFreeSchema,
  ProductAliasSchema,
  ProductCategorySchema,
  ProductContractSchema,
  ProductEntrySchema,
  PublicMachineSchema,
  StylingSupportSchema,
  resolveCopiedArtifact,
  resolveProductIdentity,
  type CopiedArtifact,
  type MachineFree,
  type ProductAlias,
  type ProductCategory,
  type ProductContract,
  type ProductEntry,
  type PublicMachine,
  type ResolvedCopiedArtifact,
  type ResolvedProductIdentity,
  type StylingSupport,
} from './product-contract.js'
export {
  RegistryFileSchema,
  RegistryItemSchema,
  RegistrySchema,
  assertSafeTarget,
  collectDependencies,
  isRemote,
  loadRegistry,
  loadRemoteItem,
  resolveItems,
  type Registry,
  type RegistryFile,
  type RegistryItem,
} from './registry.js'
