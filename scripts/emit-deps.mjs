#!/usr/bin/env node
// Emit a package's `__llui_deps.json` library-boundary manifest.
//
// Runs the @llui/compiler manifest producer over a package's `src/` and writes
// `dist/__llui_deps.json`, so consumer apps can narrow reactive bindings through
// the package's helpers instead of coarsening at the npm boundary.
//
// Usage:  node scripts/emit-deps.mjs <packageDir>
// Wired into emitting packages' build scripts (after `tsc`) and into
// scripts/publish.sh (before `pnpm publish`). Requires @llui/compiler to be
// built first (turbo `^build` handles this in the build graph).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Import the built compiler by path (the repo-root scripts dir has no
// @llui/compiler in node_modules); requires `@llui/compiler` to be built first.
const compilerEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
  'compiler',
  'dist',
  'index.js',
)
/**
 * The compiler's manifest API, typed from its own SOURCE.
 *
 * The specifier above is a runtime path, so `await import()` hands back `any`
 * and something has to state the shape. Three spellings were measured:
 *
 *   - `typeof import('.../compiler/DIST/index.js')` — exact, and REJECTED: it
 *     puts a build artifact into the `pnpm check:scripts` program, which is
 *     deliberately build-independent (see the `Scripts type check` step in
 *     `ci.yml`), so the gate would stop running on a cold checkout.
 *   - a hand-written `@typedef` of just the two entry points — cheapest, and
 *     rejected because it is a hand-maintained restatement that can drift from
 *     the real signatures silently (`serializeManifest` takes a `Manifest`, not
 *     the structural stand-in a local typedef reaches for).
 *   - `typeof import('.../compiler/SRC/index.js')` — SHIPPED. It is source, so
 *     the gate stays build-independent, and `scripts/` already reaches into
 *     package sources by relative path in three other files. Measured cost:
 *     the non-`node_modules` program grows 74 -> 104 files and `check:scripts`
 *     ~2.4 s -> ~2.8 s (load ~220, so read the delta, not the level).
 */

/** @type {unknown} */
const compilerModule = await import(compilerEntry)
const { buildManifest, serializeManifest } =
  /** @type {typeof import('../packages/compiler/src/index.js')} */ (compilerModule)

const pkgDirArg = process.argv[2]
if (!pkgDirArg) {
  console.error('usage: node scripts/emit-deps.mjs <packageDir>')
  process.exit(2)
}

const pkgDir = resolve(pkgDirArg)
const srcRoot = join(pkgDir, 'src')
const outFile = join(pkgDir, 'dist', '__llui_deps.json')

if (!existsSync(srcRoot)) {
  console.error(`emit-deps: no src/ at ${srcRoot}`)
  process.exit(1)
}

// Build a Program from the package's tsconfig.build.json (falls back to tsconfig.json).
const tsconfigPath =
  [join(pkgDir, 'tsconfig.build.json'), join(pkgDir, 'tsconfig.json')].find(existsSync) ?? undefined

// `ts.sys` alone is NOT a `ParseConfigFileHost`: it has no
// `onUnRecoverableConfigFileDiagnostic`, which TypeScript calls (unconditionally)
// for a config it cannot even begin to read. Passing `ts.sys` therefore turned
// that case into a `TypeError` on an undefined member instead of the intended
// diagnostic; the host below reports it and exits 1 the way every other failure
// path here does.
/** @type {import('typescript').ParseConfigFileHost} */
const configHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: (rootDir, extensions, excludes, includes, depth) =>
    ts.sys.readDirectory(rootDir, extensions, excludes, includes, depth),
  fileExists: (path) => ts.sys.fileExists(path),
  readFile: (path) => ts.sys.readFile(path),
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    console.error(
      `emit-deps: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')} (${tsconfigPath})`,
    )
    process.exit(1)
  },
}

/** @type {import('typescript').Program} */
let program
if (tsconfigPath) {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, configHost)
  if (!parsed) {
    console.error(`emit-deps: could not parse ${tsconfigPath}`)
    process.exit(1)
  }
  program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
} else {
  // Last resort: glob nothing meaningful — bail with an empty manifest.
  program = ts.createProgram({ rootNames: [], options: {} })
}

const manifest = buildManifest(program, { srcRoot })
const count = Object.keys(manifest.helpers).length

if (!existsSync(dirname(outFile))) mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, serializeManifest(manifest))

const pkgName = (() => {
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    const name = /** @type {{ name?: unknown }} */ (parsed).name
    return typeof name === 'string' && name !== '' ? name : pkgDir
  } catch {
    return pkgDir
  }
})()
console.log(
  `emit-deps: wrote ${count} helper entr${count === 1 ? 'y' : 'ies'} → ${pkgName}/dist/__llui_deps.json`,
)
