// `mask-legend` — emits `__maskLegend`, the per-component map from
// top-level state field name → aggregated bitmask. The agent layer
// uses this to decode a runtime `dirty` number back into the human
// names of fields that changed.
//
// Inputs are the file-level `fieldBits` / `fieldBitsHi` maps the
// umbrella has already computed via `collectDeps`. Sub-paths
// (`route.page`, `route.data`) collapse into one entry per top-level
// field so the legend reads per-field rather than per-path.
//
// The monolith historically iterated only the low-word map; the high
// word participates in mask computation but not in legend entries.
// The module preserves that behaviour exactly — see the matching
// comment in `transform.ts` near the inline `legendProps` builder.

import ts from 'typescript'
import type { CompilerModule, EmissionContribution } from '../module.js'

export interface MaskLegendModuleOptions {
  /** Path → low-word bit. */
  fieldBits: Map<string, number>
  /** Path → high-word bit. Currently unused by legend emission but
   *  accepted so the activation gate matches the monolith. */
  fieldBitsHi: Map<string, number>
}

export function maskLegendModule(options: MaskLegendModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi } = options
  return {
    name: 'mask-legend',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    emit(ctx) {
      if (fieldBits.size === 0 && fieldBitsHi.size === 0) return []
      const topLevelBits = new Map<string, number>()
      for (const [path, bit] of fieldBits) {
        const topField = path.split('.')[0]!
        topLevelBits.set(topField, (topLevelBits.get(topField) ?? 0) | bit)
      }
      const f = ctx.factory
      const legendProps: ts.PropertyAssignment[] = []
      for (const [field, bit] of topLevelBits) {
        legendProps.push(
          f.createPropertyAssignment(f.createStringLiteral(field), createMaskLiteral(f, bit)),
        )
      }
      const contribution: EmissionContribution = {
        module: 'mask-legend',
        field: '__maskLegend',
        value: f.createObjectLiteralExpression(legendProps, false),
      }
      return [contribution]
    },
  }
}

function createMaskLiteral(f: ts.NodeFactory, mask: number): ts.Expression {
  if (mask >= 0) return f.createNumericLiteral(mask)
  return f.createBinaryExpression(
    f.createNumericLiteral(0xffffffff),
    ts.SyntaxKind.BarToken,
    f.createNumericLiteral(0),
  )
}
