// In-repo validation gate for the v2b cross-file walker prototype.
//
// Builds a TS Program over @llui/components/src/ + examples/*/src/ + site/,
// runs the walker, and reports classification counts + per-helper rollup.
// Substitutes for v2b.md §2.2's dicerun2 + decisive.space-2 measurement
// per the user-directed scope decision.

import ts from 'typescript'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { walkProgram } from '/Users/franco/projects/llui/packages/compiler/dist/cross-file-walker.js'

const REPO = '/Users/franco/projects/llui'

function collectTsFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo' || name.startsWith('.')) {
      continue
    }
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      collectTsFiles(p, out)
    } else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

// In-repo source roots: components + 9 examples + site.
const roots = [
  `${REPO}/packages/components/src`,
  ...readdirSync(`${REPO}/examples`).map((n) => `${REPO}/examples/${n}/src`),
  `${REPO}/site/src`,
  `${REPO}/benchmarks/js-framework-benchmark/src`,
]
const files = []
for (const r of roots) collectTsFiles(r, files)
console.log(`Source roots: ${roots.length}; .ts files: ${files.length}`)

// Build a Program. Use the repo's root tsconfig as a base.
const tsconfigPath = resolve(REPO, 'tsconfig.json')
const rawJson = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
const parsed = ts.parseJsonConfigFileContent(rawJson, ts.sys, REPO)

const program = ts.createProgram({
  rootNames: files,
  options: { ...parsed.options, noEmit: true, skipLibCheck: true },
})
console.log(`Program source files: ${program.getSourceFiles().length}`)

// Pre-build error budget: skip global type errors that would prevent the
// walker from running. We only care about the walker's behaviour.
const preErrors = ts
  .getPreEmitDiagnostics(program)
  .filter((d) => !files.includes(d.file?.fileName ?? ''))
console.log(`Pre-emit diagnostics outside in-scope files (ignored): ${preErrors.length}`)

// Filter the walk to files in-scope (skip dependencies).
const inScope = new Set(files)
const result = walkProgram(program, {
  filter: (sf) => inScope.has(sf.fileName),
})

// Roll up by file and by diagnostic.
let totalCalls = 0,
  totalWalked = 0,
  totalOpaque = 0,
  totalAsync = 0,
  totalNotHelper = 0
for (const counts of result.perFile.values()) {
  totalCalls += counts.callsClassified
  totalWalked += counts.walked
  totalOpaque += counts.opaque
  totalAsync += counts.async
  totalNotHelper += counts.notAHelper
}

console.log(`\n=== Classification totals ===`)
console.log(`  Calls classified:  ${totalCalls}`)
console.log(`  Walked (case 1/2/3): ${totalWalked}`)
console.log(`  Opaque:            ${totalOpaque}`)
console.log(`  Async (Promise):   ${totalAsync}`)
console.log(`  Not a helper:      ${totalNotHelper}`)

console.log(`\n=== Diagnostics emitted ===`)
const byId = new Map()
for (const d of result.diagnostics) {
  byId.set(d.id, (byId.get(d.id) ?? 0) + 1)
}
for (const [id, count] of byId) console.log(`  ${id}: ${count}`)
console.log(`  total: ${result.diagnostics.length}`)

// Per-helper rollup (top opaque callees).
const opaqueByHelper = new Map()
for (const d of result.diagnostics) {
  if (d.id !== 'llui/opaque-view-call') continue
  const name = d.helperName ?? '<unknown>'
  opaqueByHelper.set(name, (opaqueByHelper.get(name) ?? 0) + 1)
}
const top = [...opaqueByHelper.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
console.log(`\n=== Top opaque callees ===`)
for (const [name, count] of top) console.log(`  ${count.toString().padStart(4)}  ${name}`)

// Total LOC for per-10k normalization.
let loc = 0
for (const f of files) {
  loc += readFileSync(f, 'utf8').split('\n').length
}
console.log(`\n=== Normalisation ===`)
console.log(`  Total in-scope LOC: ${loc}`)
console.log(`  Diagnostics per 10k LOC: ${((result.diagnostics.length / loc) * 10000).toFixed(1)}`)
console.log(`  Opaque-view-calls per 10k LOC: ${((totalOpaque / loc) * 10000).toFixed(1)}`)
