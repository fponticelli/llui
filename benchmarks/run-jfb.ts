/**
 * Run js-framework-benchmark for LLui and display comparison.
 *
 * Prerequisites:
 *   1. Clone the jfb repo:
 *      git clone https://github.com/krausest/js-framework-benchmark.git benchmarks/js-framework-benchmark-repo
 *   2. Install + build it:
 *      cd benchmarks/js-framework-benchmark-repo && npm ci && cd webdriver-ts && npm ci && npm run compile
 *
 * Usage:
 *   pnpm -w run bench                         # Run LLui only, compare against saved baselines
 *   pnpm -w run bench -- --framework vanillajs # Also re-run vanillajs
 *   pnpm -w run bench -- --all                 # Re-run all frameworks
 *   pnpm -w run bench -- --save                # Save new LLui results as baseline
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const LLUI_APP = resolve(BENCH_DIR, 'js-framework-benchmark')
const JFB_REPO = resolve(BENCH_DIR, 'js-framework-benchmark-repo')
const BASELINE = resolve(BENCH_DIR, 'jfb-baseline.json')

const BENCHMARKS = [
  { id: '01_run1k', label: 'Create 1k' },
  { id: '02_replace1k', label: 'Replace 1k' },
  { id: '03_update10th1k_x16', label: 'Update 10th' },
  { id: '04_select1k', label: 'Select' },
  { id: '05_swap1k', label: 'Swap 1↔998' },
  { id: '06_remove-one-1k', label: 'Remove' },
  { id: '07_create10k', label: 'Create 10k' },
  { id: '08_create1k-after1k_x2', label: 'Append 1k' },
  { id: '09_clear1k_x8', label: 'Clear' },
]

const COMPETITORS = ['vanillajs', 'solid', 'svelte', 'react', 'elm']

function run(cmd: string, cwd?: string) {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function runCapture(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8' })
}

// ── Parse args ──

const args = process.argv.slice(2)
const saveBaseline = args.includes('--save')
const runAll = args.includes('--all')
const extraFrameworks = args
  .filter((a) => a.startsWith('--framework'))
  .flatMap((_, i) => {
    const next = args[args.indexOf('--framework') + 1]
    return next ? [next] : []
  })

// ── Preflight checks ──

if (!existsSync(JFB_REPO)) {
  console.error('ERROR: js-framework-benchmark repo not found.')
  console.error(`Clone it:\n  git clone https://github.com/krausest/js-framework-benchmark.git ${JFB_REPO}`)
  console.error('Then install:\n  cd ' + JFB_REPO + ' && npm ci && cd webdriver-ts && npm ci && npm run compile')
  process.exit(1)
}

if (!existsSync(resolve(JFB_REPO, 'webdriver-ts/dist/benchmarkRunner.js'))) {
  console.error('ERROR: webdriver-ts not compiled. Run:')
  console.error(`  cd ${JFB_REPO}/webdriver-ts && npm ci && npm run compile`)
  process.exit(1)
}

// ── Build LLui ──

console.log('\n🔨 Building LLui benchmark app...')
run('pnpm build-prod', LLUI_APP)

// Copy built files to jfb repo
const jfbLluiDir = resolve(JFB_REPO, 'frameworks/keyed/llui')
mkdirSync(resolve(jfbLluiDir, 'dist'), { recursive: true })
copyFileSync(resolve(LLUI_APP, 'dist/main.js'), resolve(jfbLluiDir, 'dist/main.js'))
copyFileSync(resolve(LLUI_APP, 'index.html'), resolve(jfbLluiDir, 'index.html'))

// Ensure package.json exists in jfb framework dir
if (!existsSync(resolve(jfbLluiDir, 'package.json'))) {
  writeFileSync(
    resolve(jfbLluiDir, 'package.json'),
    JSON.stringify(
      {
        name: 'js-framework-benchmark-keyed-llui',
        version: '1.0.0',
        'js-framework-benchmark': {
          frameworkVersion: '0.0.0',
          frameworkHomeURL: 'https://github.com/fponticelli/llui',
          language: 'TypeScript',
        },
        scripts: { 'build-prod': "echo 'pre-built'" },
      },
      null,
      2,
    ) + '\n',
  )
}

// ── Start server if not running ──

let serverStarted = false
try {
  runCapture('curl -sf http://localhost:8080/ls')
} catch {
  console.log('Starting jfb server...')
  execSync('npm start &', { cwd: JFB_REPO, stdio: 'ignore', shell: '/bin/bash' })
  execSync('sleep 3')
  serverStarted = true
}

// ── Determine which frameworks to run ──

const frameworksToRun = ['keyed/llui']
if (runAll) {
  for (const fw of COMPETITORS) frameworksToRun.push(`keyed/${fw}`)
} else {
  for (const fw of extraFrameworks) frameworksToRun.push(`keyed/${fw}`)
}

// ── Run benchmarks ──

const webdriverDir = resolve(JFB_REPO, 'webdriver-ts')
for (const fw of frameworksToRun) {
  console.log(`\n🏃 Running benchmark: ${fw}...`)
  try {
    run(`node dist/benchmarkRunner.js --framework ${fw} --headless`, webdriverDir)
  } catch (e) {
    console.error(`Failed to run ${fw}, skipping`)
  }
}

// ── Read results ──

const baseline: Record<string, Record<string, number | null>> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : {}

const resultsDir = resolve(webdriverDir, 'results')

for (const fw of frameworksToRun) {
  const fwName = fw.replace('keyed/', '')
  if (!baseline[fwName]) baseline[fwName] = {}

  for (const b of BENCHMARKS) {
    try {
      const file = resolve(resultsDir, `${fwName}-v*_${b.id}.json`)
      // Find the actual file (version in name varies)
      const matches = runCapture(`ls ${resultsDir}/${fwName}-*_${b.id}.json 2>/dev/null`).trim().split('\n')
      if (matches[0]) {
        const data = JSON.parse(readFileSync(matches[0], 'utf8'))
        baseline[fwName][b.id] = data.values?.total?.median ?? null
      }
    } catch {
      // Keep existing baseline value
    }
  }
}

// ── Save baseline if requested ──

if (saveBaseline) {
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
  console.log(`\n✅ Baseline saved to ${BASELINE}`)
}

// ── Display results ──

const allFws = ['llui', ...COMPETITORS]
const W = 11

console.log('\n=== js-framework-benchmark — Absolute Timings (ms, median) ===\n')

const header = 'Operation'.padEnd(18) + allFws.map((n) => n.padStart(W)).join('')
console.log(header)
console.log('-'.repeat(header.length))
for (const b of BENCHMARKS) {
  let line = b.label.padEnd(18)
  for (const fw of allFws) {
    const v = baseline[fw]?.[b.id]
    line += (v != null ? v.toFixed(1) : '—').padStart(W)
  }
  console.log(line)
}

console.log('\n=== Relative to LLui (negative = faster than LLui) ===\n')

const header2 = 'Operation'.padEnd(18) + allFws.map((n) => n.padStart(W)).join('')
console.log(header2)
console.log('-'.repeat(header2.length))
for (const b of BENCHMARKS) {
  const base = baseline.llui?.[b.id]
  let line = b.label.padEnd(18)
  for (const fw of allFws) {
    if (fw === 'llui') {
      line += '——'.padStart(W)
      continue
    }
    const v = baseline[fw]?.[b.id]
    if (v == null || base == null) {
      line += '—'.padStart(W)
      continue
    }
    const pct = ((v - base) / base) * 100
    line += ((pct >= 0 ? '+' : '') + pct.toFixed(0) + '%').padStart(W)
  }
  console.log(line)
}

console.log()
