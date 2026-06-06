/**
 * Run the ticker bench suite via jfb's webdriver-ts harness.
 *
 * Prerequisites:
 *   1. `pnpm bench:setup` — clone jfb-repo (one-time).
 *   2. `pnpm bench:ticker:setup` — symlink ticker apps + apply patches.
 *
 * Usage:
 *   pnpm bench:ticker                # all 5 frameworks, all 9 ticker ops
 *   pnpm bench:ticker --framework llui
 *   pnpm bench:ticker --runs 3       # median-of-medians across N passes
 *   pnpm bench:ticker --save         # write results to ticker-baseline.json (merges)
 *   pnpm bench:ticker --headful      # don't run Chrome in headless mode
 *   pnpm bench:ticker --only burst-1k,batch-1k   # just those ops (fast iteration)
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { keepAwake } from './keep-awake'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const TICKER_DIR = resolve(BENCH_DIR, 'jfb-ticker')
const BASELINE = resolve(BENCH_DIR, 'ticker-baseline.json')
const WORKSPACE_REPO = resolve(BENCH_DIR, 'js-framework-benchmark-repo')

function detectJfbRepo(): string {
  if (process.env.JFB_REPO) return resolve(process.env.JFB_REPO)
  if (existsSync(resolve(WORKSPACE_REPO, 'webdriver-ts/dist/benchmarkRunner.js'))) {
    return WORKSPACE_REPO
  }
  const fallback = resolve(ROOT, '..', 'benchmarks', 'js-framework-benchmark-repo')
  if (existsSync(resolve(fallback, 'webdriver-ts/dist/benchmarkRunner.js'))) {
    return fallback
  }
  return WORKSPACE_REPO
}

const JFB_REPO = detectJfbRepo()

const TICKER_BENCHMARKS = [
  { id: '50_ticker_mount', label: 'mount-200' },
  { id: '51_ticker_tick-1', label: 'tick×1' },
  { id: '52_ticker_tick-100', label: 'tick×100' },
  { id: '53_ticker_burst-1k', label: 'burst-1k' },
  { id: '54_ticker_narrow-100', label: 'narrow×100' },
  { id: '55_ticker_wide-toggle', label: 'wide-toggle' },
  { id: '56_ticker_churn-50', label: 'churn-50' },
  { id: '57_ticker_clear', label: 'clear' },
  { id: '58_ticker_batch-1k', label: 'batch-1k' },
]

const FRAMEWORKS = ['llui', 'vanillajs', 'solid', 'react', 'svelte']

const args = process.argv.slice(2)
const saveBaseline = args.includes('--save')
const headful = args.includes('--headful')
let runs = 1
const fwFilter: string[] = []
// `--only burst-1k,batch-1k` (or `--only burst` / repeated flags) restricts the run
// to ticker ops whose id or label contains any of the comma-separated needles —
// handy for quickly comparing just a couple of ops without the full 9-op suite.
const onlyFilter: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--framework' && i + 1 < args.length) {
    fwFilter.push(args[i + 1]!)
    i++
  } else if (args[i] === '--runs' && i + 1 < args.length) {
    runs = Math.max(1, parseInt(args[i + 1]!, 10))
    i++
  } else if (args[i] === '--only' && i + 1 < args.length) {
    onlyFilter.push(
      ...args[i + 1]!.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    i++
  }
}
const chromeMode = headful ? '' : ' --headless'

// ── Preflight ───────────────────────────────────────────────────

if (!existsSync(resolve(JFB_REPO, 'webdriver-ts/dist/benchmarkRunner.js'))) {
  console.error('webdriver-ts not compiled. Run `pnpm bench:ticker:setup` first.')
  process.exit(1)
}

const cdpFile = resolve(JFB_REPO, 'webdriver-ts/src/benchmarksWebdriverCDP.ts')
const cdpSource = readFileSync(cdpFile, 'utf8')
if (!cdpSource.includes('benchTickerMount')) {
  console.error('Ticker patches not applied. Run `pnpm bench:ticker:setup` first.')
  process.exit(1)
}

console.log(`jfb-repo: ${JFB_REPO}`)

// ── Keep the machine awake (macOS) ──
// The ticker suite builds 5 apps then drives Chrome for the full op matrix —
// minutes per pass. An idle/system sleep mid-run skews timings or suspends the
// jfb server and Chrome. Hold a `caffeinate` assertion for the life of this run.
const stopAwake = keepAwake()

// ── Build all 5 ticker apps ─────────────────────────────────────

for (const fw of FRAMEWORKS) {
  console.log(`\n🔨 Building jfb-ticker-${fw}...`)
  execSync('pnpm run build-prod', {
    cwd: resolve(TICKER_DIR, 'frameworks', fw),
    stdio: 'inherit',
  })
}

// ── (Re)start the jfb server so it serves the freshly-built bundles ──────
// We rebuild every app above, so a server left running from a PRIOR run would
// serve STALE dist — a newly added/changed button wouldn't be found and the op
// fails with `testElementLocatedById … timed out`. Always kill any listener on
// 8080 and start fresh.

function curlOk(url: string): boolean {
  try {
    execSync(`curl -sf ${url}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

try {
  execSync('lsof -ti tcp:8080 | xargs kill 2>/dev/null', { shell: '/bin/bash', stdio: 'ignore' })
} catch {
  // nothing listening — fine
}
console.log('Starting jfb server (fresh)...')
execSync('npm start &', { cwd: JFB_REPO, stdio: 'ignore', shell: '/bin/bash' })
let ready = false
for (let i = 0; i < 15; i++) {
  execSync('sleep 1')
  if (curlOk('http://localhost:8080/ls')) {
    ready = true
    break
  }
}
if (!ready) {
  console.error('jfb server failed to start on port 8080')
  process.exit(1)
}

// ── Run benchmarks ──────────────────────────────────────────────

const webdriverDir = resolve(JFB_REPO, 'webdriver-ts')
const resultsDir = resolve(webdriverDir, 'results')

type FwResults = Record<string, Record<string, number | null>>

const baseline: FwResults = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
const current: FwResults = JSON.parse(JSON.stringify(baseline))
const samples = new Map<string, number[]>()

function readMedian(fwName: string, benchmarkId: string): number | null {
  try {
    const out = execSync(`ls ${resultsDir}/${fwName}-*_${benchmarkId}.json 2>/dev/null`, {
      encoding: 'utf8',
    }).trim()
    const first = out.split('\n')[0]
    if (!first) return null
    const data = JSON.parse(readFileSync(first, 'utf8'))
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

const toRun = fwFilter.length > 0 ? fwFilter : FRAMEWORKS
const SELECTED =
  onlyFilter.length > 0
    ? TICKER_BENCHMARKS.filter((b) =>
        onlyFilter.some((n) => b.id.includes(n) || b.label.includes(n)),
      )
    : TICKER_BENCHMARKS
if (SELECTED.length === 0) {
  console.error(
    `--only matched no ticker ops. Available: ${TICKER_BENCHMARKS.map((b) => b.label).join(', ')}`,
  )
  process.exit(1)
}
const benchIdFilter = SELECTED.map((b) => b.id).join(' ')

for (let pass = 1; pass <= runs; pass++) {
  if (runs > 1) console.log(`\n=== Pass ${pass}/${runs} ===`)
  for (const fw of toRun) {
    const target = `keyed/${fw}-ticker`
    console.log(`\n🏃 ${target}`)
    try {
      execSync(
        `node dist/benchmarkRunner.js --runner webdrivercdp --framework ${target} --benchmark ${benchIdFilter}${chromeMode}`,
        { cwd: webdriverDir, stdio: 'inherit' },
      )
    } catch {
      console.error(`Failed to run ${target}, skipping`)
      continue
    }
    const fwName = `${fw}-ticker`
    for (const b of SELECTED) {
      const m = readMedian(fwName, b.id)
      if (m == null) continue
      const key = `${fwName}/${b.id}`
      const arr = samples.get(key) ?? []
      arr.push(m)
      samples.set(key, arr)
    }
  }
}

for (const fw of toRun) {
  const fwName = `${fw}-ticker`
  if (!current[fwName]) current[fwName] = {}
  for (const b of SELECTED) {
    const arr = samples.get(`${fwName}/${b.id}`) ?? []
    const agg = medianOf(arr)
    if (agg != null) current[fwName][b.id] = agg
  }
}

// ── Display ─────────────────────────────────────────────────────

const W = 11
const LABEL_W = 16
const cols = FRAMEWORKS.map((f) => `${f}-ticker`)
console.log('\n=== Ticker results (median ms) ===\n')
let header = 'Operation'.padEnd(LABEL_W) + cols.map((n) => n.padStart(W)).join('')
console.log(header)
console.log('-'.repeat(header.length))
for (const b of SELECTED) {
  let line = b.label.padEnd(LABEL_W)
  for (const col of cols) {
    const v = current[col]?.[b.id]
    line += (v != null ? v.toFixed(1) : '—').padStart(W)
  }
  console.log(line)
}

if (saveBaseline) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n')
  console.log(`\nSaved baseline to ${BASELINE}`)
}

stopAwake()
