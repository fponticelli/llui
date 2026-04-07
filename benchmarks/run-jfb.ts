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
const BASELINE = resolve(BENCH_DIR, 'jfb-baseline.json')
const WORKSPACE_REPO = resolve(BENCH_DIR, 'js-framework-benchmark-repo')

// Check if a jfb repo is usable (has compiled webdriver-ts).
function isValidJfbRepo(dir: string): boolean {
  return existsSync(resolve(dir, 'webdriver-ts/dist/benchmarkRunner.js'))
}

// Discover which jfb install to use. If a server is running on :8080, use its cwd
// (so we copy dist into the install that's actually serving). Otherwise fall back to
// the workspace-embedded repo. Override with JFB_REPO env var.
function detectJfbRepo(): string {
  if (process.env.JFB_REPO) return resolve(process.env.JFB_REPO)
  try {
    // Server's cwd is <repo>/server — walk up one level.
    const out = execSync(
      "lsof -n -iTCP:8080 -sTCP:LISTEN -Fn 2>/dev/null | head -1 | sed 's/^n//' || true",
      { encoding: 'utf8' },
    ).trim()
    if (!out) return WORKSPACE_REPO
    const pidLine = execSync('lsof -n -iTCP:8080 -sTCP:LISTEN -Fp 2>/dev/null | head -1', {
      encoding: 'utf8',
    }).trim()
    const pid = pidLine.startsWith('p') ? pidLine.slice(1) : ''
    if (!pid) return WORKSPACE_REPO
    const cwd = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | tail -1 | sed 's/^n//'`, {
      encoding: 'utf8',
    }).trim()
    // server cwd looks like .../<repo>/server → parent is the repo root.
    if (cwd.endsWith('/server')) {
      const candidate = dirname(cwd)
      // Only use the detected repo if it's actually valid; otherwise fall
      // back to the workspace copy (avoids picking up a stale /tmp repo).
      if (isValidJfbRepo(candidate)) return candidate
    }
  } catch {
    // fall through
  }
  return WORKSPACE_REPO
}

const JFB_REPO = detectJfbRepo()

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

const MEMORY_BENCHMARKS = [
  { id: '21_ready-memory', label: 'Ready (MB)' },
  { id: '22_run-memory', label: 'Run 1k (MB)' },
  { id: '25_run-clear-memory', label: 'Clear (MB)' },
]

const SIZE_BENCHMARKS = [
  { id: '41_size-uncompressed', label: 'Uncompressed (kB)' },
  { id: '42_size-compressed', label: 'Gzipped (kB)' },
]

const ALL_BENCHMARKS = [...BENCHMARKS, ...MEMORY_BENCHMARKS, ...SIZE_BENCHMARKS]

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
const headful = args.includes('--headful')
const extraFrameworks: string[] = []
let runs = 1
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--framework' && i + 1 < args.length) {
    extraFrameworks.push(args[i + 1]!)
    i++
  } else if (args[i] === '--runs' && i + 1 < args.length) {
    runs = Math.max(1, parseInt(args[i + 1]!, 10))
    i++
  }
}
const chromeMode = headful ? '' : ' --headless'

// ── Preflight checks ──

console.log(`📦 jfb repo: ${JFB_REPO}`)

if (!existsSync(JFB_REPO)) {
  console.error('ERROR: js-framework-benchmark repo not found.')
  console.error(
    `Clone it:\n  git clone https://github.com/krausest/js-framework-benchmark.git ${WORKSPACE_REPO}`,
  )
  console.error(
    'Then install:\n  cd ' +
      WORKSPACE_REPO +
      ' && npm ci && cd webdriver-ts && npm ci && npm run compile',
  )
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
const resultsDir = resolve(webdriverDir, 'results')

type FwResults = Record<string, Record<string, number | null>>

const baseline: FwResults = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}

// Current = baseline seed for frameworks we didn't re-run, overlayed with fresh results.
const current: FwResults = JSON.parse(JSON.stringify(baseline))

// Accumulate medians from each run for each fw×benchmark.
const samples = new Map<string, number[]>() // key: "fw/benchmarkId"

function readMedian(fwName: string, benchmarkId: string): number | null {
  try {
    const matches = runCapture(`ls ${resultsDir}/${fwName}-*_${benchmarkId}.json 2>/dev/null`)
      .trim()
      .split('\n')
    if (!matches[0]) return null
    const data = JSON.parse(readFileSync(matches[0], 'utf8'))
    // CPU benchmarks nest under values.total; memory/size under values.DEFAULT.
    return data.values?.total?.median ?? data.values?.DEFAULT?.median ?? null
  } catch {
    return null
  }
}

function medianOf(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

for (let pass = 1; pass <= runs; pass++) {
  if (runs > 1) console.log(`\n=== Pass ${pass}/${runs} ===`)
  for (const fw of frameworksToRun) {
    console.log(`\n🏃 Running benchmark: ${fw}...`)
    try {
      run(`node dist/benchmarkRunner.js --framework ${fw}${chromeMode}`, webdriverDir)
    } catch {
      console.error(`Failed to run ${fw}, skipping`)
      continue
    }
    const fwName = fw.replace('keyed/', '')
    for (const b of ALL_BENCHMARKS) {
      const m = readMedian(fwName, b.id)
      if (m == null) continue
      const key = `${fwName}/${b.id}`
      const arr = samples.get(key) ?? []
      arr.push(m)
      samples.set(key, arr)
    }
  }
}

// Aggregate: median of per-run medians
for (const fw of frameworksToRun) {
  const fwName = fw.replace('keyed/', '')
  if (!current[fwName]) current[fwName] = {}
  for (const b of ALL_BENCHMARKS) {
    const arr = samples.get(`${fwName}/${b.id}`) ?? []
    const agg = medianOf(arr)
    if (agg != null) current[fwName][b.id] = agg
  }
}

// ── Display results ──

const allFws = ['llui', ...COMPETITORS]
const W = 11
const LABEL_W = 20

type Bench = { id: string; label: string }

function printAbsolute(title: string, benches: Bench[]) {
  console.log(`\n=== ${title} ===\n`)
  const header = 'Operation'.padEnd(LABEL_W) + allFws.map((n) => n.padStart(W)).join('')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const b of benches) {
    let line = b.label.padEnd(LABEL_W)
    for (const fw of allFws) {
      const v = current[fw]?.[b.id]
      line += (v != null ? v.toFixed(1) : '—').padStart(W)
    }
    console.log(line)
  }
}

function printRelative(title: string, benches: Bench[]) {
  console.log(`\n=== ${title} ===\n`)
  const header = 'Operation'.padEnd(LABEL_W) + allFws.map((n) => n.padStart(W)).join('')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const b of benches) {
    const base = current.llui?.[b.id]
    let line = b.label.padEnd(LABEL_W)
    for (const fw of allFws) {
      if (fw === 'llui') {
        line += '—'.padStart(W)
        continue
      }
      const v = current[fw]?.[b.id]
      if (v == null || base == null) {
        line += '—'.padStart(W)
        continue
      }
      const pct = ((v - base) / base) * 100
      line += ((pct >= 0 ? '+' : '') + pct.toFixed(0) + '%').padStart(W)
    }
    console.log(line)
  }
}

printAbsolute('Absolute Timings (ms, median)', BENCHMARKS)
printRelative('Relative to LLui (negative = faster than LLui)', BENCHMARKS)
printAbsolute('Memory (MB)', MEMORY_BENCHMARKS)
printRelative('Memory Relative to LLui (negative = less than LLui)', MEMORY_BENCHMARKS)
printAbsolute('Bundle Size (kB)', SIZE_BENCHMARKS)
printRelative('Bundle Size Relative to LLui (negative = smaller than LLui)', SIZE_BENCHMARKS)

// ── LLui: current vs baseline ──

const baselineLlui = baseline.llui
const currentLlui = current.llui
if (baselineLlui && currentLlui && baselineLlui !== currentLlui) {
  console.log('\n=== LLui: Current vs Baseline ===\n')
  const hdr =
    'Operation'.padEnd(LABEL_W) +
    'Baseline'.padStart(W) +
    'Current'.padStart(W) +
    'Delta'.padStart(W)
  console.log(hdr)
  console.log('-'.repeat(hdr.length))
  let anySignificant = false
  const groups: [string, Bench[]][] = [
    ['Timings (ms)', BENCHMARKS],
    ['Memory (MB)', MEMORY_BENCHMARKS],
    ['Bundle (kB)', SIZE_BENCHMARKS],
  ]
  for (const [groupLabel, benches] of groups) {
    console.log(`  — ${groupLabel} —`)
    for (const b of benches) {
      const base = baselineLlui[b.id]
      const cur = currentLlui[b.id]
      let line = b.label.padEnd(LABEL_W)
      line += (base != null ? base.toFixed(1) : '—').padStart(W)
      line += (cur != null ? cur.toFixed(1) : '—').padStart(W)
      if (base != null && cur != null && base !== 0) {
        const pct = ((cur - base) / base) * 100
        const mark = Math.abs(pct) >= 5 ? (pct < 0 ? ' ✓' : ' ⚠') : '  '
        if (Math.abs(pct) >= 5) anySignificant = true
        line += ((pct >= 0 ? '+' : '') + pct.toFixed(0) + '%' + mark).padStart(W + 2)
      } else {
        line += '—'.padStart(W)
      }
      console.log(line)
    }
  }
  if (!anySignificant) console.log('\n  (all deltas within ±5% noise)')
}

// ── Save baseline if requested ──

if (saveBaseline) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
  console.log(`\n✅ Baseline saved to ${BASELINE}`)
}

console.log()
