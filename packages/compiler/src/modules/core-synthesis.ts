// `core-synthesis` — thin CompilerModule wrapper around the inline
// `tryInjectDirty` in transform.ts. Owns the co-emitted core trio:
//   - `__update`         — the Phase 1/2 dispatcher; reads `structuralMask`
//   - `__handlers`       — per-message-type specialized handlers
//   - `__prefixes`       — array of path-keyed reference-stable closures
//
// The three are NOT decomposable into separate modules (per v2c §7.9.2
// design decision (a) vs (b)): they share `topLevelBits` /
// `structuralMask` / `fieldBits` intermediates, and `__prefixes` ordering
// is bit-position-keyed (the array index *is* the bit position used by
// every binding's mask). Producing them in three independent emit
// passes would either duplicate the analysis or require a shared
// scratchpad slot — both lose vs the function's existing single pass.
//
// So this module is a **wrapper**: it owns the registry call path
// (transformCallEnter on `component()` calls), but the actual 600+
// lines of synthesis (`tryBuildHandlers`, `buildCaseHandler`,
// `buildUpdateBody`, `buildPrefixesProp`, `computeStructuralMask`,
// `buildAccess`) stay in transform.ts and are called via the
// exported `tryInjectDirty` entry.
//
// Side-effect: the inline call sets `usesApplyBinding = true` when
// the rewrite fires (drives `__runPhase2` + `__handleMsg` imports in
// `cleanupImports`). The module surfaces this via `CORE_SYNTHESIS_SLOT`
// for the umbrella to read after `registry.run`.

import type { CompilerModule } from '../module.js'
import { isComponentCall, tryInjectDirty } from '../transform.js'
import type ts from 'typescript'

export interface CoreSynthesisModuleOptions {
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
  /** Component() call detection requires the @llui/dom import binding
   *  to disambiguate from user-local `component` identifiers. */
  lluiImport: ts.ImportDeclaration
}

export interface CoreSynthesisSlot {
  /** True when at least one component() call got the __update/__handlers/__prefixes
   *  trio injected — drives `cleanupImports`'s decision about `__runPhase2`
   *  + `__handleMsg` runtime imports. */
  usesApplyBinding: boolean
}

export const CORE_SYNTHESIS_SLOT = 'core-synthesis:state'

export function coreSynthesisModule(opts: CoreSynthesisModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi, lluiImport } = opts
  return {
    name: 'core-synthesis',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (!isComponentCall(node, lluiImport)) return null
      const rewritten = tryInjectDirty(node, fieldBits, ctx.factory, fieldBitsHi)
      if (!rewritten) return null
      const slot = ctx.analysis.perModule.get(CORE_SYNTHESIS_SLOT) as CoreSynthesisSlot | undefined
      if (slot) slot.usesApplyBinding = true
      else
        ctx.analysis.perModule.set(CORE_SYNTHESIS_SLOT, {
          usesApplyBinding: true,
        } as CoreSynthesisSlot)
      return rewritten
    },
  }
}
