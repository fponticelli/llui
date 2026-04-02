#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const BASELINE_PATH = join(import.meta.dirname, 'baseline.json')

const apps = [{ name: 'counter', dir: join(ROOT, 'examples/counter') }]

function measure(dir) {
  execSync('pnpm build', { cwd: dir, stdio: 'pipe' })
  const assetsDir = join(dir, 'dist/assets')
  const results = { chunks: 0, raw: 0, gzip: 0 }

  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith('.js')) continue
    const path = join(assetsDir, file)
    const raw = statSync(path).size
    const gzip = parseInt(execSync(`gzip -9c "${path}" | wc -c`).toString().trim(), 10)
    results.chunks++
    results.raw += raw
    results.gzip += gzip
  }

  return results
}

// Run measurements
const results = {}
for (const app of apps) {
  results[app.name] = measure(app.dir)
}

// Load baseline if it exists
let baseline = {}
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

// Print results
console.log()
console.log('=== Bundle Size ===')
console.log()

for (const [name, data] of Object.entries(results)) {
  const prev = baseline[name]
  const rawDelta = prev ? data.raw - prev.raw : 0
  const gzipDelta = prev ? data.gzip - prev.gzip : 0

  const rawStr = `raw=${data.raw} B`
  const gzipStr = `gzip=${data.gzip} B`
  const deltaStr = prev
    ? `  (${sign(rawDelta)} raw, ${sign(gzipDelta)} gzip)`
    : '  (no baseline)'

  console.log(`  ${name}: ${rawStr}  ${gzipStr}${deltaStr}`)
}

console.log()

// Check for regressions
let failed = false
for (const [name, data] of Object.entries(results)) {
  const prev = baseline[name]
  if (!prev) continue
  const gzipDelta = data.gzip - prev.gzip
  if (gzipDelta > 50) {
    console.log(`  ⚠ REGRESSION: ${name} gzip grew by ${gzipDelta} B (threshold: 50 B)`)
    failed = true
  }
}

if (!failed && Object.keys(baseline).length > 0) {
  console.log('  ✓ No regressions')
}

console.log()

function sign(n) {
  if (n > 0) return `+${n} B`
  if (n < 0) return `${n} B`
  return '±0 B'
}

// --save flag writes current results as the new baseline
if (process.argv.includes('--save')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + '\n')
  console.log(`  Baseline saved to ${BASELINE_PATH}`)
}
