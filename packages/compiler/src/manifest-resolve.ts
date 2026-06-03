// Consumer-side manifest resolution. When the cross-file walker hits a call
// `lib.helper(s)` whose target it cannot follow (declaration is a body-less
// `.d.ts` in a published package), it asks here whether that package ships a
// `__llui_deps.json` and, if so, for the matching `HelperEntry`. The walker then
// runs `substituteHelperCall` instead of coarsening to opaque.
//
// Everything here is best-effort and side-effect-free w.r.t. correctness: a
// miss / incompatible / malformed manifest yields a result the caller turns into
// a safe coarsen (never a dropped dependency).

import ts from 'typescript'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { HelperEntry, Manifest } from './manifest.js'
import { parseManifest, MANIFEST_RELATIVE_PATH, HELPER_KEY_SEP } from './manifest-io.js'

export interface ManifestHelperLookup {
  manifest: Manifest
  packageName: string
  /** `<moduleId>#<exportName>`, the canonical helper key (also used as the substitution label). */
  helperKey: string
  /** The matched entry, or undefined when the package ships a manifest but not this helper. */
  entry: HelperEntry | undefined
}

export type ManifestLookupResult =
  | { kind: 'found'; lookup: ManifestHelperLookup }
  /** No package / no manifest file — coarsen silently (the common case). */
  | { kind: 'absent' }
  /** Manifest present but version-incompatible — coarsen + emit a diagnostic. */
  | { kind: 'incompatible'; detail: string }
  /** Manifest present but unparseable/structurally wrong — coarsen + emit a diagnostic. */
  | { kind: 'malformed'; detail: string }

// Per-package-root manifest cache for the compile session. Deps are static
// during a build; `clearManifestCache()` exists for tests.
const manifestCache = new Map<string, ManifestCacheEntry>()
type ManifestCacheEntry =
  | { kind: 'found'; manifest: Manifest }
  | { kind: 'absent' }
  | { kind: 'incompatible'; detail: string }
  | { kind: 'malformed'; detail: string }

export function clearManifestCache(): void {
  manifestCache.clear()
}

/**
 * Resolve the manifest helper entry for a call-site callee symbol.
 *
 * @param sym   the (possibly aliased) symbol of the call target
 * @param checker the program's type checker
 */
export function lookupHelperFromSymbol(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
): ManifestLookupResult {
  const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
  const decl = resolved.getDeclarations()?.find((d) => d.getSourceFile())
  if (!decl) return { kind: 'absent' }

  const fileName = decl.getSourceFile().fileName
  const pkgRoot = findPackageRoot(fileName)
  if (!pkgRoot) return { kind: 'absent' }

  const cached = loadPackageManifest(pkgRoot)
  if (cached.kind !== 'found') return cached

  const moduleId = moduleIdFromFile(pkgRoot, fileName)
  const exportName = resolved.getName()
  const helperKey = `${moduleId}${HELPER_KEY_SEP}${exportName}`
  // Prefer the module-qualified key; fall back to the bare export name so
  // single-module / fixture packages can key by name alone.
  const entry = cached.manifest.helpers[helperKey] ?? cached.manifest.helpers[exportName]

  return {
    kind: 'found',
    lookup: {
      manifest: cached.manifest,
      packageName: packageNameOf(pkgRoot),
      helperKey,
      entry,
    },
  }
}

// ── package + module resolution ─────────────────────────────────────

function loadPackageManifest(pkgRoot: string): ManifestCacheEntry {
  const hit = manifestCache.get(pkgRoot)
  if (hit) return hit

  const manifestPath = join(pkgRoot, MANIFEST_RELATIVE_PATH)
  let entry: ManifestCacheEntry
  if (!existsSync(manifestPath)) {
    entry = { kind: 'absent' }
  } else {
    let text: string
    try {
      text = readFileSync(manifestPath, 'utf8')
    } catch (e) {
      entry = { kind: 'malformed', detail: `cannot read ${manifestPath}: ${(e as Error).message}` }
      manifestCache.set(pkgRoot, entry)
      return entry
    }
    const parsed = parseManifest(text)
    entry = parsed.ok
      ? { kind: 'found', manifest: parsed.manifest }
      : { kind: parsed.reason, detail: parsed.detail }
  }
  manifestCache.set(pkgRoot, entry)
  return entry
}

/** Walk up from a source file to the nearest directory containing package.json. */
function findPackageRoot(fileName: string): string | undefined {
  let dir = dirname(fileName)
  // Bound the walk; node_modules nesting is shallow in practice.
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/**
 * Canonical module id: the declaration file's path relative to the package
 * root, with a leading `dist/` or `src/` stripped and the extension removed.
 * Emit derives the same id from `src/`; consume derives it from the published
 * `dist/` `.d.ts` — they agree because `tsc` mirrors `src/` into `dist/`.
 */
function moduleIdFromFile(pkgRoot: string, fileName: string): string {
  let rel = relative(pkgRoot, fileName).split(sep).join('/')
  rel = rel.replace(/^(dist|src)\//, '')
  rel = rel.replace(/\.d\.ts$/, '').replace(/\.(ts|tsx|js|mjs|cjs|jsx)$/, '')
  return rel
}

function packageNameOf(pkgRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as { name?: string }
    return pkg.name ?? pkgRoot
  } catch {
    return pkgRoot
  }
}
