/**
 * Standalone bundle analyzer for the jfb bench app. Builds with sourcemaps
 * + a Rollup plugin that records each module's contribution, then prints a
 * grouped summary by package / src directory.
 *
 * Usage:  pnpm tsx benchmarks/bundle-analyzer.ts
 */

import { build, type Plugin } from 'vite'
import { resolve, dirname, relative } from 'node:path'
import { writeFileSync } from 'node:fs'

const ROOT = dirname(import.meta.dirname)
const BENCH = resolve(ROOT, 'benchmarks/js-framework-benchmark')

// Import the workspace-built plugin directly so this script has the same
// dependency edge as the production build of the bench app.
const lluiModule = (await import(resolve(ROOT, 'packages/vite-plugin/dist/index.js'))) as {
  default: () => Plugin
}
const llui = lluiModule.default

interface ModuleContribution {
  id: string
  bytes: number
  group: string
}

const contributions: ModuleContribution[] = []

const reportPlugin: Plugin = {
  name: 'bundle-analyzer',
  generateBundle(_opts, bundle) {
    for (const [, chunk] of Object.entries(bundle)) {
      if (chunk.type !== 'chunk') continue
      const modInfo = chunk.modules
      for (const [id, info] of Object.entries(modInfo)) {
        const bytes = info.renderedLength
        if (bytes === 0) continue
        contributions.push({ id, bytes, group: groupOf(id) })
      }
    }
  },
}

function groupOf(id: string): string {
  // Normalize pnpm-symlinked paths into a stable package label.
  const norm = id.replace(/.*node_modules\/[^/]+\/[^/]+\//, '__virtual__/')
  if (norm.startsWith('__virtual__/')) return norm.split('/').slice(0, 2).join('/')
  const rel = relative(ROOT, id)
  if (rel.startsWith('packages/dom/src/primitives/')) return 'dom/primitives'
  if (rel.startsWith('packages/dom/src/ssr/')) return 'dom/ssr'
  if (rel.startsWith('packages/dom/src/tracking/')) return 'dom/tracking'
  if (rel.startsWith('packages/dom/src/internal/')) return 'dom/internal'
  if (rel.startsWith('packages/dom/src/')) return 'dom/core'
  if (rel.startsWith('packages/compiler')) return 'compiler'
  if (rel.startsWith('packages/vite-plugin')) return 'vite-plugin'
  if (rel.startsWith('packages/')) return 'packages/' + (rel.split('/')[1] ?? 'unknown')
  if (rel.startsWith('benchmarks/js-framework-benchmark/src')) return 'app'
  return 'other'
}

console.log('🔨 building jfb with bundle analyzer...')
await build({
  root: BENCH,
  configFile: false,
  plugins: [llui(), reportPlugin],
  build: {
    target: 'es2022',
    minify: true,
    modulePreload: { polyfill: false },
    lib: {
      entry: resolve(BENCH, 'src/main.ts'),
      formats: ['es'],
      fileName: () => 'main.js',
    },
    outDir: resolve(BENCH, 'dist'),
    rollupOptions: { output: { inlineDynamicImports: true }, external: [/devtools/] },
  },
})

// ── Aggregate by group ──
const byGroup = new Map<string, { bytes: number; modules: ModuleContribution[] }>()
let total = 0
for (const c of contributions) {
  if (!byGroup.has(c.group)) byGroup.set(c.group, { bytes: 0, modules: [] })
  const g = byGroup.get(c.group)!
  g.bytes += c.bytes
  g.modules.push(c)
  total += c.bytes
}

const sortedGroups = Array.from(byGroup.entries()).sort((a, b) => b[1].bytes - a[1].bytes)

console.log(
  `\n--- bundle composition by group (rendered bytes, total=${total.toLocaleString()}) ---`,
)
console.log(`  ${'group'.padEnd(28)}  ${'bytes'.padStart(8)}  ${'%'.padStart(6)}  modules`)
for (const [group, info] of sortedGroups) {
  const pct = ((info.bytes / total) * 100).toFixed(1)
  console.log(
    `  ${group.padEnd(28)}  ${info.bytes.toLocaleString().padStart(8)}  ${pct.padStart(5)}%  ${info.modules.length}`,
  )
}

console.log('\n--- per-module breakdown (≥ 100 bytes only) ---')
const sortedMods = contributions.slice().sort((a, b) => b.bytes - a.bytes)
for (const m of sortedMods) {
  if (m.bytes < 100) break
  const rel = relative(ROOT, m.id)
  console.log(`  ${m.bytes.toString().padStart(6)} bytes  ${rel}`)
}

// Persist for diffing across phases.
const out = {
  total,
  byGroup: Object.fromEntries(
    sortedGroups.map(([k, v]) => [k, { bytes: v.bytes, modules: v.modules.length }]),
  ),
  modules: sortedMods.map((m) => ({ id: relative(ROOT, m.id), bytes: m.bytes, group: m.group })),
}
writeFileSync(resolve(ROOT, 'benchmarks/bundle-composition.json'), JSON.stringify(out, null, 2))
console.log(`\n💾 detailed composition → benchmarks/bundle-composition.json`)
