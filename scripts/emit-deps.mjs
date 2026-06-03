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
const { buildManifest, serializeManifest } = await import(compilerEntry)

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

let program
if (tsconfigPath) {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, ts.sys) // eslint-disable-line
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
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name ?? pkgDir
  } catch {
    return pkgDir
  }
})()
console.log(
  `emit-deps: wrote ${count} helper entr${count === 1 ? 'y' : 'ies'} → ${pkgName}/dist/__llui_deps.json`,
)
