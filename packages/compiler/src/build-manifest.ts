// Producer for the `__llui_deps.json` library-boundary manifest. Walks a
// package's source `Program` and, for each exported helper that a consumer can
// narrow through, emits a `HelperEntry`.
//
// Scope: this v1 producer analyzes the shape that actually routes through
// consumer-side manifest substitution — `state.map(s => helper(s))`, i.e. a
// helper that takes the STATE VALUE directly and reads sub-paths off it
// (`state-value` params). `connect`/`overlay`-style parts/view helpers compose
// via runtime Signal handles (`connect(state.at('x'), send)`), which the
// compiler does not narrow, so they are not emitted. Every parameter the
// producer cannot characterize is emitted `opaque` (or the helper is skipped),
// so partial coverage is always SOUND — a consumer coarsens, never mis-narrows.
//
// The per-parameter read analysis is `signals/analyze-deps.ts` — the SAME
// analyzer the view transform uses. It used to be a second, independent one
// (`collect-deps.ts`) that truncated reads at two path segments; producer and
// consumer must agree exactly, so they now share the one implementation (#92).

import ts from 'typescript'
import { relative, sep } from 'node:path'
import { COMPILER_VERSION } from './version.js'
import { HELPER_KEY_SEP } from './manifest-io.js'
import { analyzeAccessor } from './signals/analyze-deps.js'
import type { Manifest, HelperEntry, ParamSpec } from './manifest.js'

export interface BuildManifestOptions {
  /** Absolute path to the package's source root (e.g. `<pkg>/src`); module ids are relative to it. */
  srcRoot: string
}

/**
 * Build a manifest from a package's source program. Only emits entries that
 * carry useful narrowing info (at least one `state-value` param with reads);
 * helpers that would contribute nothing are omitted (a missing entry coarsens
 * identically, so this just keeps the manifest lean).
 */
export function buildManifest(program: ts.Program, opts: BuildManifestOptions): Manifest {
  const checker = program.getTypeChecker()
  const helpers: Record<string, HelperEntry> = {}
  const srcRoot = normalize(opts.srcRoot)

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const file = normalize(sf.fileName)
    if (!file.startsWith(srcRoot + '/')) continue
    if (file.includes('/node_modules/')) continue

    const moduleId = moduleIdOf(srcRoot, file)
    const moduleSym = checker.getSymbolAtLocation(sf)
    if (!moduleSym) continue

    for (const exp of checker.getExportsOfModule(moduleSym)) {
      const fn = exportedFunctionDecl(exp)
      if (!fn) continue
      const entry = analyzeHelper(fn)
      if (!entry) continue
      helpers[`${moduleId}${HELPER_KEY_SEP}${exp.getName()}`] = entry
    }
  }

  return { version: 2, compilerVersion: COMPILER_VERSION, helpers, components: {} }
}

// ── per-helper analysis ─────────────────────────────────────────────

/** Resolve an exported symbol to a function-like declaration with a body, if any. */
function exportedFunctionDecl(
  sym: ts.Symbol,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  for (const decl of sym.getDeclarations() ?? []) {
    if (ts.isFunctionDeclaration(decl) && decl.body) return decl
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      const init = decl.initializer
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) return init
    }
  }
  return undefined
}

/**
 * Produce a HelperEntry for a helper, or undefined if it carries no narrowing
 * value. Each parameter is classified: a state-value param (read via member
 * access) → `state-value` with its sub-path reads; a `send` param → `send`;
 * anything else → `opaque` (safe coarsen).
 */
function analyzeHelper(
  fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): HelperEntry | undefined {
  if (!fn.body) return undefined

  const viaParams: ParamSpec[] = []
  let hasReads = false

  // One analyzer, one answer: `analyzeAccessor` is the same dependency analysis
  // the view transform runs, so a helper's emitted `reads` are exactly the paths
  // a binding through that helper would gate on — at full depth, with no
  // two-segment truncation (issue #92). Its per-parameter contract carries the
  // opacity signal too: a parameter that ESCAPES (passed whole to a call, spread,
  // returned) yields the empty path `''`, i.e. "the whole parameter".
  const { deps } = analyzeAccessor(fn)

  fn.parameters.forEach((param, index) => {
    const read = deps[index]
    // A destructured param has no single name to key reads by in the v1 entry
    // shape, and an escaped/unread param cannot be narrowed. Both → opaque, which
    // makes the consumer coarsen — never mis-narrow.
    if (!ts.isIdentifier(param.name) || !read || read.size === 0 || read.has('')) {
      viaParams.push({ index, shape: 'opaque' })
      return
    }
    hasReads = true
    viaParams.push({ index, shape: 'state-value', reads: [...read].sort() })
  })

  if (!hasReads) return undefined // nothing to narrow — omit
  return { kind: 'view-helper', helperLocalPaths: [], viaParams }
}

// ── module-id derivation (mirrors manifest-resolve) ─────────────────

function moduleIdOf(srcRoot: string, file: string): string {
  let rel = relative(srcRoot, file).split(sep).join('/')
  rel = rel.replace(/\.(ts|tsx)$/, '')
  return rel
}

function normalize(p: string): string {
  return p.split(sep).join('/').replace(/\/$/, '')
}
