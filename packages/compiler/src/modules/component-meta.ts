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

import ts from 'typescript'
import type { CompilerModule, EmissionContribution } from '../module.js'

interface ComponentMetaSlot {
  /** All component() calls discovered in the file, in source order. */
  calls: ts.CallExpression[]
}

const SLOT_NAME = 'component-meta:calls'

export const componentMetaModule: CompilerModule = {
  name: 'component-meta',
  compilerVersion: '^0.3.0',
  diagnostics: [],

  visitors: {
    [ts.SyntaxKind.CallExpression]: (ctx, node) => {
      const call = node as ts.CallExpression
      // Match `component(...)` — identifier callee, name 'component'.
      // The umbrella's import-resolution step disambiguates against
      // `@llui/dom`'s component vs. a user-local function of the same
      // name; for this POC we accept all `component(...)` calls and
      // rely on the import-resolution pass to filter at emission time.
      // (The monolith's injectComponentMeta does the same — it sees
      // every component() call site after the visitor walk.)
      if (!ts.isIdentifier(call.expression) || call.expression.text !== 'component') {
        return
      }
      const slot = ctx.getSlot<ComponentMetaSlot>(SLOT_NAME, () => ({ calls: [] }))
      slot.calls.push(call)
    },
  },

  emit(ctx, analysis): EmissionContribution[] {
    const slot = analysis.perModule.get(SLOT_NAME) as ComponentMetaSlot | undefined
    if (!slot || slot.calls.length === 0) return []
    const sf = ctx.sourceFile
    const out: EmissionContribution[] = []
    for (const call of slot.calls) {
      // Position computation: getStart against the source file. For
      // synthetic nodes (pos < 0) we fall back to line 0.
      const pos = call.pos >= 0 ? call.getStart(sf) : 0
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
        target: call,
      })
    }
    return out
  },
}
