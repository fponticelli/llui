// `compiler-stamp` — emits the umbrella-level integrity marker on
// every compiled `component()` call:
//
//   - `__lluiCompilerEmitted: 1` — the marker scanned by the Vite
//     adapter's closeBundle integrity check. A bundled component
//     missing this property indicates the LLui transform was skipped
//     for that file, which is a hard build error.
//   - `__compilerVersion: '<semver>'` — the runtime contract version
//     (v2a §2.4 / v2b §5). The runtime gates feature-detection on
//     this; a missing version falls back to `genericUpdate`
//     (FULL_MASK) with a console warning.
//
// Per-target emission so each `component()` call in a multi-component
// file gets its own pair. Always-on regardless of agent/dev mode —
// no activation gate. This is the umbrella's mandatory module.

import { COMPILER_VERSION } from '../version.js'
import type { CompilerModule, EmissionContribution } from '../module.js'
import { findComponentCalls } from './_shared.js'

export const compilerStampModule: CompilerModule = {
  name: 'compiler-stamp',
  compilerVersion: '^0.3.0',
  diagnostics: [],
  // Targets captured in `emit` — see `_shared.ts`.
  visitors: {},

  emit(ctx, analysis) {
    const f = ctx.factory
    const contributions: EmissionContribution[] = []
    for (const n of findComponentCalls(analysis.sourceFile)) {
      contributions.push({
        module: 'compiler-stamp',
        field: '__lluiCompilerEmitted',
        value: f.createNumericLiteral(1),
        target: n,
      })
      contributions.push({
        module: 'compiler-stamp',
        field: '__compilerVersion',
        value: f.createStringLiteral(COMPILER_VERSION),
        target: n,
      })
    }
    return contributions
  },
}
