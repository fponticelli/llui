// @llui/compiler-introspection — runtime introspection metadata (opt-in).
//
// This package emits metadata that supports runtime introspectors:
// the end-user-facing `@llui/agent-bridge` (in-app AI) and the
// dev-facing `@llui/mcp` (dev LLM tooling). Both consume the same
// compiled output; the package is named for the compile-time concern
// rather than for any single consumer.
//
//   - state-schema           __stateSchema
//   - msg-annotations        __msgAnnotations
//   - msg-schema             __msgSchema + __effectSchema
//   - schema-hash            __schemaHash (HMR re-send gating)
//   - mask-legend            __maskLegend (decode dirty mask → field name)
//   - binding-descriptors    handler tagging + scope-variant registration
//
// Activation: opt-in via `introspection()` factory in llui.config.ts.
//
// Modules move here in v2c/decomp-26 (scaffolding lands first in
// v2c/decomp-24; this file is the placeholder index).

export {}
