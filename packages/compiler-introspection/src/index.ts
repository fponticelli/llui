// @llui/compiler-introspection — runtime introspection metadata (opt-in).
//
// Emits the compile-time metadata that downstream runtime
// introspectors consume: the end-user-facing `@llui/agent-bridge`
// (in-app agent) and the dev-facing `@llui/mcp` (dev LLM tooling).
// Both reads the same compiled output; this package owns the
// emission side, the runtime packages own the consumption side.
//
// Modules:
//   - msg-schema             __msgSchema + __effectSchema
//   - msg-annotations        __msgAnnotations
//   - state-schema           __stateSchema
//   - schema-hash            __schemaHash (HMR re-send gating)
//   - binding-descriptors    preTransform pass tagging handler
//                            arrows with __lluiVariants
//
// Activation: opt-in. The package registers a factory with
// `@llui/compiler` via `registerIntrospectionFactory`. The host
// (test setup, Vite plugin, MCP) imports this package and calls
// `registerIntrospectionFactory(introspectionFactory)` once at
// process start. transformLlui then activates the modules when
// `shouldEmitAgentMetadata` is true.

import { type IntrospectionFactory, type CompilerModule, type MsgSchema } from '@llui/compiler'
import { msgSchemaModule, type MsgSchemaModuleOptions } from './msg-schema.js'
import { stateSchemaModule, type StateSchemaModuleOptions } from './state-schema.js'
import { msgAnnotationsModule, type MsgAnnotationsModuleOptions } from './msg-annotations.js'
import { schemaHashModule, SCHEMA_HASH_INPUTS_SLOT, type SchemaHashInputs } from './schema-hash.js'
import { bindingDescriptorsModule, BINDING_DESCRIPTORS_SLOT } from './binding-descriptors.js'

// Re-export individual modules + slots so adapters that want fine-
// grained control (e.g. a test that wants only schemaHash) can still
// reach them. The default consumption path is the factory below.
export {
  msgSchemaModule,
  type MsgSchemaModuleOptions,
  stateSchemaModule,
  type StateSchemaModuleOptions,
  msgAnnotationsModule,
  type MsgAnnotationsModuleOptions,
  schemaHashModule,
  SCHEMA_HASH_INPUTS_SLOT,
  type SchemaHashInputs,
  bindingDescriptorsModule,
  BINDING_DESCRIPTORS_SLOT,
}

/**
 * Builds the introspection module set for a single source file.
 * Activation order matches the v2c/decomp-7 design:
 *   1. `bindingDescriptorsModule`  — preTransform fires first so the
 *      universal handler-tagger + scope-variant-registration runs
 *      before any visitor or emit phase sees the file.
 *   2. `msgSchemaModule`, `stateSchemaModule`, `msgAnnotationsModule`
 *      — producer modules populate the schema-hash inputs slot.
 *   3. `schemaHashModule` — emit reads the populated slot.
 *
 * Per-module activation gates mirror what `transformLlui` did inline
 * before decomp-26:
 *   - `msgSchemaModule`     when at least one of Msg / Effect schemas extracted
 *   - `stateSchemaModule`   when State schema extracted
 *   - `msgAnnotationsModule` when annotation map non-null (includes empty)
 *   - `schemaHashModule`    always (well-defined hash over null inputs)
 *   - `bindingDescriptorsModule` always when introspection is on
 *
 * The "always-on schemaHash" comes from spec §7.4: the hash ships in
 * prod too, used by HMR re-send gating regardless of agent mode.
 */
export const introspectionFactory: IntrospectionFactory = (input) => {
  const modules: CompilerModule[] = []

  // Agent-gated modules — only fire when shouldEmitAgentMetadata is true.
  // binding-descriptors and the schema producers all emit metadata the
  // end-user agent / dev MCP reads; out of agent mode they're dead weight.
  if (input.shouldEmitAgentMetadata) {
    // binding-descriptors fires FIRST (preTransform pass) so subsequent
    // module visitors see the post-mutation source file.
    modules.push(bindingDescriptorsModule)

    // Producer modules — order matters: they populate the schema-hash
    // inputs slot before schemaHashModule's emit consumes it.
    const msgSchema = input.msgSchema as MsgSchema | null
    const effectSchema = input.effectSchema as MsgSchema | null
    if (msgSchema || effectSchema) {
      modules.push(msgSchemaModule({ msgSchema, effectSchema }))
    }
    const stateSchema = input.stateSchema as Parameters<typeof stateSchemaModule>[0]['stateSchema']
    if (stateSchema) {
      modules.push(stateSchemaModule({ stateSchema }))
    }
    const msgAnnotations = input.msgAnnotations as Parameters<
      typeof msgAnnotationsModule
    >[0]['msgAnnotations']
    if (msgAnnotations !== null) {
      modules.push(msgAnnotationsModule({ msgAnnotations }))
    }
  }

  // schemaHashModule registers UNCONDITIONALLY — hash is well-defined
  // for null inputs (deterministic). HMR re-send gating consumes the
  // hash in prod builds (spec §7.4) even when no other introspection
  // metadata is emitted.
  modules.push(schemaHashModule)

  return modules
}
