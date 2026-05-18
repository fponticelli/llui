// `schema-hash` — CompilerModule wrapper around `computeSchemaHash`.
//
// Per `MODULE-MAPPING.md`, this is an **agent** concern: the hash signals
// schema drift across HMR cycles, and only matters when the agent
// runtime cares about Msg/State schema stability. When the agent module
// is disabled, this module is excluded from the registry — bundles
// don't carry `__schemaHash` and the HMR re-send heuristic falls back
// to "always re-send".
//
// The module reads its inputs from sibling-module slots:
//   - `msg-schema`'s slot for the MsgSchema object
//   - `state-schema`'s slot for the StateSchema object
//   - `msg-annotations`'s slot for the annotation map
//
// Today none of those sibling modules exist yet — the monolith's
// `transform.ts` still owns the schema extraction. So this module's
// `emit` falls back to "no contribution" when the slots are empty.
// The agent-pipeline decomposition push fills the sibling slots and
// flips this module from no-op to authoritative.
//
// Test fixture: `test/poc-module-schema-hash.test.ts` constructs a
// fake AnalysisContext with populated slots and asserts the emitted
// __schemaHash matches `computeSchemaHash`'s direct output. This proves
// the registry+module path produces a byte-identical hash without
// requiring the full sibling-module pipeline.

import ts from 'typescript'
import { computeSchemaHash } from '../schema-hash.js'
import type { MessageAnnotations } from '../msg-annotations.js'
import type { CompilerModule, EmissionContribution } from '../module.js'

/**
 * Slot shape modules write to populate this module's inputs. Sibling
 * agent modules (msg-schema, state-schema, msg-annotations) write their
 * outputs here under the same conventional slot name.
 */
export interface SchemaHashInputs {
  msgSchema: unknown
  stateSchema: unknown
  msgAnnotations: Record<string, MessageAnnotations> | null
}

export const SCHEMA_HASH_INPUTS_SLOT = 'schema-hash:inputs'

export const schemaHashModule: CompilerModule = {
  name: 'schema-hash',
  compilerVersion: '^0.3.0',
  dependsOn: [],
  diagnostics: [],

  // No visitor pass — this module is a pure emit consumer. Sibling
  // modules populate the inputs slot during their own visitor pass.
  visitors: {},

  emit(_ctx, analysis): EmissionContribution[] {
    const slot = analysis.perModule.get(SCHEMA_HASH_INPUTS_SLOT) as SchemaHashInputs | undefined
    if (!slot) return []
    // Skip when there's nothing to hash. The monolith's behaviour:
    // `__schemaHash` is emitted whenever ANY of the three inputs is
    // non-null, because the hash itself is well-defined for null
    // members (sortDeep normalises null to null in the JSON).
    if (slot.msgSchema === null && slot.stateSchema === null && slot.msgAnnotations === null) {
      return []
    }
    const hash = computeSchemaHash({
      msgSchema: slot.msgSchema,
      stateSchema: slot.stateSchema,
      msgAnnotations: slot.msgAnnotations,
    })
    return [
      {
        module: 'schema-hash',
        field: '__schemaHash',
        value: ts.factory.createStringLiteral(hash),
      },
    ]
  },
}
