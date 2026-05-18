// `msg-schema` — emits `__msgSchema` + `__effectSchema` per
// `component()` call and populates the schema-hash inputs slot.
// Factory module taking the pre-computed MsgSchema for Msg and Effect.
//
// Migrated from inline `injectMsgSchema` + `injectEffectSchema` in
// transform.ts (v2c/decomp-5). The literal builder
// `msgSchemaToLiteral` (from `msg-schema.ts`) is shared between the
// two emissions — Msg and Effect use the same discriminated-union
// shape on the wire.
//
// When this module is in the active list alongside `state-schema`
// and `msg-annotations`, the schema-hash inputs slot is fully
// populated and `schemaHashModule` produces the authoritative
// `__schemaHash` emission. At that point the inline
// `injectSchemaHash` in transform.ts also deletes — see
// v2c/decomp-5's migration.

import type { CompilerModule, EmissionContribution } from '../module.js'
import { msgSchemaToLiteral, type MsgSchema } from '../msg-schema.js'
import { SCHEMA_HASH_INPUTS_SLOT, type SchemaHashInputs } from './schema-hash.js'
import { findComponentCalls } from './_shared.js'

export interface MsgSchemaModuleOptions {
  /** Pre-computed Msg schema; null when extraction failed. */
  msgSchema: MsgSchema | null
  /** Pre-computed Effect schema; null when not present in source. */
  effectSchema: MsgSchema | null
}

export function msgSchemaModule(opts: MsgSchemaModuleOptions): CompilerModule {
  return {
    name: 'msg-schema',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    // Targets captured in `emit` — see `_shared.ts`.
    visitors: {},

    emit(ctx, analysis): EmissionContribution[] {
      // Populate schema-hash inputs slot with our msgSchema input — the
      // schemaHashModule will pick it up alongside whatever
      // stateSchemaModule and msgAnnotationsModule wrote.
      if (opts.msgSchema !== null) {
        const hashInputs = analysis.perModule.get(SCHEMA_HASH_INPUTS_SLOT) as
          | SchemaHashInputs
          | undefined
        if (hashInputs) {
          hashInputs.msgSchema = opts.msgSchema
        } else {
          analysis.perModule.set(SCHEMA_HASH_INPUTS_SLOT, {
            msgSchema: opts.msgSchema,
            stateSchema: null,
            msgAnnotations: null,
          } as SchemaHashInputs)
        }
      }
      const calls = findComponentCalls(analysis.sourceFile)
      if (calls.length === 0) return []
      const out: EmissionContribution[] = []
      for (const call of calls) {
        if (opts.msgSchema !== null) {
          out.push({
            module: 'msg-schema',
            field: '__msgSchema',
            value: msgSchemaToLiteral(opts.msgSchema, ctx.factory),
            target: call,
          })
        }
        if (opts.effectSchema !== null) {
          out.push({
            module: 'msg-schema',
            field: '__effectSchema',
            value: msgSchemaToLiteral(opts.effectSchema, ctx.factory),
            target: call,
          })
        }
      }
      return out
    },
  }
}
