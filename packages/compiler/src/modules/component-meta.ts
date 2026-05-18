// `component-meta` — emits `__componentMeta: { file, line }` per
// `component()` call. Today's `injectComponentMeta` in transform.ts
// is gated on devMode; this module keeps the gating semantics by
// accepting an option (the umbrella passes `devMode` through).
//
// This is the first per-component-targeted emission in the registry.
// It validates the `EmissionContribution.target` shape (v2c §7.9
// finding from the schema-hash POC): when multiple `component()`
// calls live in one file, each gets its own `__componentMeta` with
// its own line number, and the conflict-detector lets each emission
// through because the `(field, target)` tuples are distinct.

import type { CompilerModule, EmissionContribution } from '../module.js'
import { findComponentCalls } from './_shared.js'

export const componentMetaModule: CompilerModule = {
  name: 'component-meta',
  compilerVersion: '^0.3.0',
  diagnostics: [],
  // Targets captured in `emit` (not `visit`) — see `_shared.ts`
  // `findComponentCalls` for the rationale (Phase 2b rebuilds
  // ancestor nodes, invalidating visit-captured refs).
  visitors: {},

  emit(ctx, analysis): EmissionContribution[] {
    const sf = analysis.sourceFile
    const calls = findComponentCalls(sf)
    if (calls.length === 0) return []
    const out: EmissionContribution[] = []
    for (const n of calls) {
      const pos = n.pos >= 0 ? n.getStart(sf) : 0
      const { line } = sf.getLineAndCharacterOfPosition(pos)
      const meta = ctx.factory.createObjectLiteralExpression(
        [
          ctx.factory.createPropertyAssignment(
            'file',
            ctx.factory.createStringLiteral(sf.fileName),
          ),
          ctx.factory.createPropertyAssignment('line', ctx.factory.createNumericLiteral(line + 1)),
        ],
        false,
      )
      out.push({
        module: 'component-meta',
        field: '__componentMeta',
        value: meta,
        target: n,
      })
    }
    return out
  },
}
