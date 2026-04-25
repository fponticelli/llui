#!/usr/bin/env node
/**
 * Rewrites relative imports in all workspace package sources to include
 * explicit `.js` extensions. Required for Node strict ESM compatibility:
 * TypeScript's `moduleResolution: bundler` allows extensionless imports
 * in source, but the compiled `.js` files preserve them as-is, which
 * Node's loader rejects.
 *
 * TypeScript has allowed (and preferred) `.js` extensions in source
 * since forever — all modern tooling (Vite, esbuild, Rollup, Bun, tsc,
 * Node ESM) handles them correctly. Adding them is a one-time source-
 * level fix that eliminates the class of bug in published tarballs.
 *
 * What it rewrites:
 *   from './foo'      → from './foo.js'
 *   from '../foo/bar' → from '../foo/bar.js'
 *   import './side'   → import './side.js'
 *   export * from './x' → export * from './x.js'
 *
 * What it skips:
 *   - Non-relative imports (package names)
 *   - Imports that already have an extension (.js, .ts, .css, .json, .mjs, .cjs)
 *   - Dynamic imports that reference runtime strings
 *   - Comments
 *
 * Usage: node scripts/add-js-extensions.mjs [--dry]
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DRY = process.argv.includes('--dry')

// Discover packages dynamically — every directory under `packages/` with a
// `src/` subdirectory is a candidate. Avoids the "stale hardcoded list misses
// a newly-added package" failure mode that left @llui/eslint-plugin without
// .js extension rewrites for several releases.
const PACKAGES = readdirSync(join(ROOT, 'packages'))
  .filter((name) => {
    try {
      return statSync(join(ROOT, 'packages', name, 'src')).isDirectory()
    } catch {
      return false
    }
  })
  .sort()

const SKIP_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.json', '.svg'])

function hasExtension(path) {
  const lastSlash = path.lastIndexOf('/')
  const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
  const lastDot = basename.lastIndexOf('.')
  if (lastDot <= 0) return false // hidden files or no dot
  const ext = basename.slice(lastDot)
  return SKIP_EXTENSIONS.has(ext)
}

function findTsFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) findTsFiles(full, files)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(full)
  }
  return files
}

// Matches these patterns, capturing the module specifier in group `path`:
//   from '...'      from "..."
//   import '...'    import "..."
//   export ... from '...'
// Stops at unescaped quotes. Does not attempt to parse comments — matches
// on the entire file. False positives inside strings are extremely rare
// for this pattern, but we can add a heuristic if needed.
const IMPORT_REGEX =
  /(?<prefix>(?:import|export)\b[^'"]*?\bfrom\s*|import\s*)(?<quote>['"])(?<path>[^'"]+)\2/g

let totalFiles = 0
let totalEdits = 0

for (const pkg of PACKAGES) {
  const srcDir = join(ROOT, 'packages', pkg, 'src')
  try {
    statSync(srcDir)
  } catch {
    continue
  }
  const files = findTsFiles(srcDir)
  let pkgEdits = 0
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    let edits = 0
    const newContent = content.replace(IMPORT_REGEX, (match, prefix, quote, path) => {
      // Only rewrite RELATIVE imports
      if (!path.startsWith('./') && !path.startsWith('../')) return match
      // Skip if it already has an extension
      if (hasExtension(path)) return match
      edits++
      return `${prefix}${quote}${path}.js${quote}`
    })
    if (edits > 0) {
      pkgEdits += edits
      if (!DRY) writeFileSync(file, newContent)
    }
  }
  if (pkgEdits > 0) {
    console.log(`${pkg}: ${pkgEdits} edits across ${files.length} files`)
    totalFiles += files.length
    totalEdits += pkgEdits
  }
}

console.log('')
console.log(`Total: ${totalEdits} edits across ${totalFiles} files${DRY ? ' (DRY RUN)' : ''}`)
