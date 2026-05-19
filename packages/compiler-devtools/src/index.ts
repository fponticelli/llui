// @llui/compiler-devtools — dev-MCP / LLM tooling support (opt-in).
//
// Emits compile-time metadata the dev MCP (`@llui/mcp`) and future
// devtools UI consume. Distinct from `@llui/compiler-introspection`
// which emits shared metadata (schemas, hashes, legend) that BOTH
// the end-user agent AND dev tooling consume; this package emits
// dev-only debug aids that don't need to ship in end-user builds.
//
// Modules:
//   - component-meta           __componentMeta: { file, line }
//   - (future) trace instrumentation: _eachDiffLog, _disposerLog,
//     _effectTimeline, _coverage when the runtime devtools spec lands
//
// Activation: opt-in. Hosts (Vite plugin, MCP, test setup) import
// this package and call `registerDevtoolsFactory(devtoolsFactory)`.
// transformLlui then activates modules per the factory's gating
// rules (today: componentMeta runs when devMode is true).

import { type DevtoolsFactory, type CompilerModule } from '@llui/compiler'
import { componentMetaModule } from './component-meta.js'

export { componentMetaModule }

/**
 * Builds the devtools module set for a single source file.
 * Activation gates mirror what `transformLlui` did inline before
 * decomp-27:
 *   - `componentMetaModule`    when `devMode` is true
 *
 * Future devtools modules (trace instrumentation) would gate on a
 * separate `enableTraceInstrumentation` flag the host passes via
 * the factory input.
 */
export const devtoolsFactory: DevtoolsFactory = (input) => {
  const modules: CompilerModule[] = []
  if (input.devMode) {
    modules.push(componentMetaModule)
  }
  return modules
}
