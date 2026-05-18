// `state-schema` — emits `__stateSchema` per `component()` call and
// populates the schema-hash inputs slot. Factory module: takes the
// pre-computed StateSchema (from `extractStateSchema` upstream, with
// cross-file resolution if available) and emits its literal form
// targeted at each component() call site.
//
// Migrated from the inline `injectStateSchema` in transform.ts. The
// monolith's `extractStateSchema(...)` call lives in transformLlui's
// setup section and gets passed into the factory; the module consumes
// it without re-running the extractor. This keeps the extraction
// authoritative at the umbrella level (where pre-extracted cross-file
// data + type-source overrides are already wired) and frees the module
// from re-implementing input resolution.

import type { CompilerModule, EmissionContribution } from '../module.js'
import { stateTypeToLiteral, type StateSchema } from '../state-schema.js'
import { SCHEMA_HASH_INPUTS_SLOT, type SchemaHashInputs } from './schema-hash.js'
import { findComponentCalls } from './_shared.js'

export interface StateSchemaModuleOptions {
  /** Pre-computed schema (cross-file aware) — null when extraction failed. */
  stateSchema: StateSchema | null
}

export function stateSchemaModule(opts: StateSchemaModuleOptions): CompilerModule {
  return {
    name: 'state-schema',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    // Targets captured in `emit` — see `_shared.ts`.
    visitors: {},

    emit(ctx, analysis): EmissionContribution[] {
      if (!opts.stateSchema) return []
      const calls = findComponentCalls(analysis.sourceFile)
      if (calls.length === 0) return []

      // Populate the schema-hash inputs slot. The schema-hash module
      // reads this on its own emit pass and computes the hash. Module
      // ordering is observable per v2c §2.1: when `stateSchemaModule`
      // appears in the active module list before `schemaHashModule`,
      // the inputs slot is populated when schema-hash's emit runs.
      const hashInputs = analysis.perModule.get(SCHEMA_HASH_INPUTS_SLOT) as
        | SchemaHashInputs
        | undefined
      if (hashInputs) {
        hashInputs.stateSchema = opts.stateSchema
      } else {
        analysis.perModule.set(SCHEMA_HASH_INPUTS_SLOT, {
          msgSchema: null,
          stateSchema: opts.stateSchema,
          msgAnnotations: null,
        } as SchemaHashInputs)
      }

      return calls.map((call) => ({
        module: 'state-schema',
        field: '__stateSchema',
        value: stateTypeToLiteral(
          { kind: 'object', fields: opts.stateSchema!.fields },
          ctx.factory,
        ),
        target: call,
      }))
    },
  }
}
