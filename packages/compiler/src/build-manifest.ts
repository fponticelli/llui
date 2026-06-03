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

import ts from 'typescript'
import { relative, sep } from 'node:path'
import { COMPILER_VERSION } from './version.js'
import { HELPER_KEY_SEP } from './manifest-io.js'
import { extractPaths, detectOpaqueStateFlow, type OpaqueOut } from './collect-deps.js'
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
  const body = fn.body
  if (!body) return undefined

  const viaParams: ParamSpec[] = []
  let hasReads = false

  fn.parameters.forEach((param, index) => {
    if (!ts.isIdentifier(param.name)) {
      // Destructured params aren't mapped to reads in v1 → opaque (safe).
      viaParams.push({ index, shape: 'opaque' })
      return
    }
    const name = param.name.text

    // Reuse the canonical in-app extractor + opacity detector so producer and
    // consumer agree exactly. A param that LEAKS (passed whole, element-access,
    // delegated to an opaque call, used bare) is opaque → the consumer coarsens,
    // never mis-narrows. A param read only via clean member access becomes a
    // `state-value` param carrying those exact sub-paths.
    const paths = new Set<string>()
    extractPaths(body, name, '', paths)
    const opaque: OpaqueOut = { value: false }
    detectOpaqueStateFlow(body, name, opaque)

    if (!opaque.value && paths.size > 0) {
      hasReads = true
      viaParams.push({ index, shape: 'state-value', reads: [...paths].sort() })
    } else {
      // Leaked, scalar, send handle, or otherwise not a clean state read.
      viaParams.push({ index, shape: 'opaque' })
    }
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
