// `msg-annotations` — emits `__msgAnnotations` per `component()` call
// when the annotation map has any non-default field, and populates the
// schema-hash inputs slot. Factory module taking the pre-computed
// annotation map (from `extractMsgAnnotations` / cross-file resolver
// upstream).
//
// Migrated from inline `injectMsgAnnotations` in transform.ts (v2c/
// decomp-4). The "gate on hasNonDefaultAnnotation" rule preserves: when
// every variant carries default intent/alwaysAffordable/etc., the
// emission is suppressed (runtime treats absence as defaults). This is
// a real win for un-annotated Msg unions, which dominate.

import type { CompilerModule, EmissionContribution } from '@llui/compiler'
import {
  annotationsToObjectLiteral,
  hasNonDefaultAnnotation,
  type MessageAnnotations,
} from '@llui/compiler'
import { SCHEMA_HASH_INPUTS_SLOT, type SchemaHashInputs } from './schema-hash.js'
import { findComponentCalls } from '@llui/compiler'

export interface MsgAnnotationsModuleOptions {
  /** Pre-computed annotation map. Null when extraction failed; empty
   * record when there are no Msg variants at all. */
  msgAnnotations: Record<string, MessageAnnotations> | null
}

export function msgAnnotationsModule(opts: MsgAnnotationsModuleOptions): CompilerModule {
  return {
    name: 'msg-annotations',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    // Targets captured in `emit` — see `_shared.ts`.
    visitors: {},

    emit(_ctx, analysis): EmissionContribution[] {
      const annotations = opts.msgAnnotations
      // Populate schema-hash inputs regardless of `hasNonDefault` — the
      // hash is over the full annotation map (defaults included), so it
      // must reflect the resolver's output verbatim.
      if (annotations !== null) {
        const hashInputs = analysis.perModule.get(SCHEMA_HASH_INPUTS_SLOT) as
          | SchemaHashInputs
          | undefined
        if (hashInputs) {
          hashInputs.msgAnnotations = annotations
        } else {
          analysis.perModule.set(SCHEMA_HASH_INPUTS_SLOT, {
            msgSchema: null,
            stateSchema: null,
            msgAnnotations: annotations,
          } as SchemaHashInputs)
        }
      }
      if (!annotations || !hasNonDefaultAnnotation(annotations)) return []
      const calls = findComponentCalls(analysis.sourceFile)
      if (calls.length === 0) return []
      return calls.map((call) => ({
        module: 'msg-annotations',
        field: '__msgAnnotations',
        value: annotationsToObjectLiteral(annotations),
        target: call,
      }))
    },
  }
}
