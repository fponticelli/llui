#!/usr/bin/env node
// Verify the PUBLISHED shape of each package's build output. Three invariants
// that are invisible in-repo (everything resolves fine from the workspace) and
// only break once a consumer installs the tarball:
//
//   1. Every relative import in `dist/**/*.js` carries a `.js` extension. Node's
//      ESM resolver does not guess — an extensionless specifier is a hard
//      ERR_MODULE_NOT_FOUND for every consumer. `scripts/add-js-extensions.mjs`
//      adds them post-tsc; if that pass breaks, nothing else notices.
//
//   2. Every sourcemap's `sources` resolve to a file that is actually SHIPPED.
//      These packages deliberately do NOT set `inlineSources`: `files` already
//      includes `src`, so the .ts sources ship verbatim and the maps point at
//      them relatively (`../../src/signals/mount.ts`). Embedding them too would
//      duplicate ~340KB per package for nothing. But that arrangement is
//      load-bearing — drop `src` from `files`, or move `outDir`, and every
//      published sourcemap silently resolves to nothing.
//
//   3. No ORPHANED artifacts: `tsc` never deletes the output of a source that
//      was removed, so a stale `dist/` ships dead modules (a documented landmine
//      — `scripts/publish.sh` `rm -rf dist` before building for exactly this
//      reason). A map whose source is gone is the cheapest way to detect it.
//
// Imports are found by PARSING with the TypeScript compiler, not by regex: this
// repo's own compiler sources quote `export { X } from './y'` inside comments
// and doc strings, and a text scan reports those as violations. A release gate
// that cries wolf gets disabled.
//
// Lives here rather than as a snippet in the /publish skill because inline doc
// snippets rot — the previous versions of these checks pointed at
// `packages/dom/dist/mount.js`, a path that had not existed for some time, so
// one passed vacuously and the other could never have passed at all.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, normalize } from 'node:path'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')

/** Publishable package dirs (no `private: true`), or the ones named on argv. */
function targets() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (named.length) return named
  return readdirSync('packages').filter((d) => {
    const p = `packages/${d}/package.json`
    return existsSync(p) && !JSON.parse(readFileSync(p, 'utf8')).private
  })
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walk(f, out)
    else out.push(f)
  }
  return out
}

/** Relative module specifiers this file really imports/exports from — static,
 * `export … from`, and dynamic `import()`. Comments and unrelated strings are
 * not reachable from these nodes, so they cannot produce a false hit. */
function relativeSpecifiers(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const out = []
  const add = (node) => {
    if (node && ts.isStringLiteral(node) && node.text.startsWith('.')) out.push(node.text)
  }
  ;(function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(node.arguments[0])
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal)
    ts.forEachChild(node, visit)
  })(sf)
  return out
}

const problems = []

for (const pkgDir of targets()) {
  const root = `packages/${pkgDir}`
  const dist = `${root}/dist`
  if (!existsSync(dist)) {
    problems.push(`${pkgDir}: no dist/ — build before running this check`)
    continue
  }
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  // Top-level names in `files` decide what ships. A map source outside them is
  // dangling in the tarball even though it resolves here in the workspace.
  const shipped = new Set((pkg.files ?? []).map((f) => f.replace(/^\.\//, '').split('/')[0]))

  for (const file of walk(dist)) {
    if (file.endsWith('.js')) {
      for (const spec of relativeSpecifiers(file, readFileSync(file, 'utf8'))) {
        if (!spec.endsWith('.js')) problems.push(`${file}: extensionless import "${spec}"`)
      }
    } else if (file.endsWith('.map')) {
      const map = JSON.parse(readFileSync(file, 'utf8'))
      for (const s of map.sources ?? []) {
        const abs = normalize(join(dirname(file), s))
        const pkgRelative = relative(root, abs)
        if (!existsSync(abs)) {
          problems.push(
            `${file}: source "${s}" is gone — ORPHANED artifact of a deleted source; run a clean build (rm -rf ${dist})`,
          )
        } else if (pkgRelative.startsWith('..')) {
          problems.push(`${file}: source "${s}" escapes the package root`)
        } else if (!shipped.has(pkgRelative.split('/')[0])) {
          problems.push(
            `${file}: source "${s}" is not shipped — "${pkgRelative.split('/')[0]}" missing from package.json "files" (${[...shipped].join(', ')})`,
          )
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`✗ dist integrity: ${problems.length} problem(s)\n`)
  for (const p of problems.slice(0, 20)) console.error(`   ${p}`)
  if (problems.length > 20) console.error(`   … and ${problems.length - 20} more`)
  console.error('')
  process.exit(1)
}

console.log('✓ dist integrity: imports carry .js, sourcemap sources exist and ship')
