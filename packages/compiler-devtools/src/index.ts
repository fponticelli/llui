// @llui/compiler-devtools — dev-MCP / LLM tooling support (opt-in, dev-mode).
//
// This package emits compile-time metadata the dev MCP (`@llui/mcp`)
// and future devtools UI consume. Distinct from
// `@llui/compiler-introspection`: introspection emits shared metadata
// (schemas, hashes, legend) that BOTH agent and dev tooling consume;
// this package emits dev-only debug aids that don't ship to end-user
// builds.
//
//   - component-meta            __componentMeta: { file, line }
//   - (future) trace instrumentation: _eachDiffLog, _disposerLog,
//     _effectTimeline, _coverage hook insertion when the runtime
//     devtools spec lands
//
// Activation: opt-in via `devtools()` factory in llui.config.ts.
// Depends on @llui/compiler-introspection (devtools consumes the
// schemas/legend that introspection emits).
//
// Modules move here in v2c/decomp-27 (scaffolding lands first in
// v2c/decomp-24; this file is the placeholder index).

export {}
