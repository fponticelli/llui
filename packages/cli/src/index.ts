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
