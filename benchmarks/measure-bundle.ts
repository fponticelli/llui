/**
 * Builds the jfb bench app and measures bundle size (uncompressed + gzip + brotli).
 * Records into benchmarks/bundle-baseline.json under a phase label, prints diffs.
 *
 * Usage:
 *   pnpm tsx benchmarks/measure-bundle.ts                     # measure, label "current", diff baseline
 *   pnpm tsx benchmarks/measure-bundle.ts --phase 1.1         # measure under "1.1-tree-shake-audit"
 *   pnpm tsx benchmarks/measure-bundle.ts --phase 1.1 --save  # also persist under that phase
 *   pnpm tsx benchmarks/measure-bundle.ts --label X --save    # arbitrary label
 *   pnpm tsx benchmarks/measure-bundle.ts --show              # print stored baseline only
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib'

const ROOT = dirname(import.meta.dirname)
const BENCH = resolve(ROOT, 'benchmarks/js-framework-benchmark')
const BUNDLE = resolve(BENCH, 'dist/main.js')
const BASELINE = resolve(ROOT, 'benchmarks/bundle-baseline.json')

interface Phase {
  label: string
  summary: string
  uncompressed: number
  gzipped: number
  brotli: number
  deltaVsPrevious: { uncompressed: number; gzipped: number; brotli: number } | null
  deltaVsBaseline: { uncompressed: number; gzipped: number; brotli: number } | null
}

interface Baseline {
  $schema?: string
  $description?: string
  $measureCommand?: string
  phases: Record<string, Phase>
}

function arg(name: string, fallback: string): string {
  const a = process.argv.slice(2)
  const i = a.indexOf(name)
  return i >= 0 && i + 1 < a.length ? a[i + 1]! : fallback
}
function flag(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

const baseline: Baseline = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline)
  : { phases: {} }

if (flag('--show')) {
  printTable(baseline)
  process.exit(0)
}

// ── Build ──
console.log('🔨 building jfb bench app...')
execSync('pnpm build-prod', { cwd: BENCH, stdio: 'inherit' })

// ── Measure ──
if (!existsSync(BUNDLE)) {
  console.error(`ERROR: ${BUNDLE} missing — build failed?`)
  process.exit(1)
}
const src = readFileSync(BUNDLE)
const uncompressed = src.length
const gzipped = gzipSync(src, { level: 9 }).length
const brotli = brotliCompressSync(src, {
  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
}).length

console.log(
  `\n📦 dist/main.js: ${uncompressed.toLocaleString()} bytes uncompressed, ` +
    `${gzipped.toLocaleString()} gz, ${brotli.toLocaleString()} br`,
)

// ── Diffs ──
const phaseKey = arg('--phase', 'current')
const label = arg('--label', `Phase ${phaseKey}`)
const summary = arg('--summary', '(no summary)')

const phaseOrder = Object.keys(baseline.phases)
const prevPhaseKey = phaseOrder[phaseOrder.length - 1]
const prev = prevPhaseKey && prevPhaseKey !== phaseKey ? baseline.phases[prevPhaseKey] : null
const base = baseline.phases['0-baseline']

const deltaVsPrevious = prev
  ? {
      uncompressed: uncompressed - prev.uncompressed,
      gzipped: gzipped - prev.gzipped,
      brotli: brotli - prev.brotli,
    }
  : null
const deltaVsBaseline =
  base && phaseKey !== '0-baseline'
    ? {
        uncompressed: uncompressed - base.uncompressed,
        gzipped: gzipped - base.gzipped,
        brotli: brotli - base.brotli,
      }
    : null

const phase: Phase = {
  label,
  summary,
  uncompressed,
  gzipped,
  brotli,
  deltaVsPrevious,
  deltaVsBaseline,
}

if (flag('--save')) {
  baseline.phases[phaseKey] = phase
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`💾 saved phase "${phaseKey}" → ${BASELINE}`)
}

if (deltaVsPrevious || deltaVsBaseline) {
  console.log('')
  if (deltaVsPrevious && prev) {
    const d = deltaVsPrevious
    console.log(
      `  Δ vs ${prev.label}: ${signed(d.uncompressed)} bytes uncompressed, ` +
        `${signed(d.gzipped)} gz, ${signed(d.brotli)} br`,
    )
  }
  if (deltaVsBaseline && base) {
    const d = deltaVsBaseline
    const pct = (x: number, b: number): string => ((x / b) * 100).toFixed(1) + '%'
    console.log(
      `  Δ vs baseline: ${signed(d.uncompressed)} bytes uncompressed (${pct(d.uncompressed, base.uncompressed)}), ` +
        `${signed(d.gzipped)} gz (${pct(d.gzipped, base.gzipped)}), ` +
        `${signed(d.brotli)} br (${pct(d.brotli, base.brotli)})`,
    )
  }
}

printTable(baseline)

function signed(n: number): string {
  return n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString()
}

function printTable(b: Baseline): void {
  console.log(`\n--- bundle size by phase (dist/main.js) ---`)
  console.log(
    `  ${'phase'.padEnd(28)}  ${'uncompressed'.padStart(13)}  ${'gzipped'.padStart(8)}  ${'brotli'.padStart(8)}  vs-baseline`,
  )
  const base = b.phases['0-baseline']
  for (const [key, p] of Object.entries(b.phases)) {
    const vsBase = base ? ((p.uncompressed - base.uncompressed) / base.uncompressed) * 100 : 0
    const pct =
      base && key !== '0-baseline' ? `${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(1)}%` : '—'
    console.log(
      `  ${(key + ' ' + p.label).slice(0, 28).padEnd(28)}  ` +
        `${p.uncompressed.toLocaleString().padStart(13)}  ` +
        `${p.gzipped.toLocaleString().padStart(8)}  ` +
        `${p.brotli.toLocaleString().padStart(8)}  ${pct}`,
    )
  }
}
