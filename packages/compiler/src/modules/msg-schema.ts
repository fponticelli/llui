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

import ts from 'typescript'
import type { CompilerModule, EmissionContribution } from '../module.js'
import { msgSchemaToLiteral, type MsgSchema } from '../msg-schema.js'
import { SCHEMA_HASH_INPUTS_SLOT, type SchemaHashInputs } from './schema-hash.js'

interface MsgSchemaSlot {
  calls: ts.CallExpression[]
}

const SLOT_NAME = 'msg-schema:calls'

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

    visitors: {
      [ts.SyntaxKind.CallExpression]: (ctx, node) => {
        const call = node as ts.CallExpression
        if (!ts.isIdentifier(call.expression) || call.expression.text !== 'component') return
        const slot = ctx.getSlot<MsgSchemaSlot>(SLOT_NAME, () => ({ calls: [] }))
        slot.calls.push(call)
      },
    },

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
      const slot = analysis.perModule.get(SLOT_NAME) as MsgSchemaSlot | undefined
      if (!slot || slot.calls.length === 0) return []
      const out: EmissionContribution[] = []
      for (const call of slot.calls) {
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
