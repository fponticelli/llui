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
 *   pnpm bench:all --runs 5 --save   # save a complete canonical baseline
 *   pnpm bench:ticker --headful      # don't run Chrome in headless mode
 *   pnpm bench:ticker --only burst-1k,batch-1k   # just those ops (fast iteration)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { keepAwake } from './keep-awake'
import {
  type BenchmarkMatrix,
  assertCompleteTickerBaseline,
  readBenchmarkBaseline,
  writeBenchmarkSuiteCandidate,
} from './lib/benchmark-baseline'
import { prepareFreshResultsDirectory, readCompleteBenchmarkResults } from './lib/benchmark-results'
import { startManagedProcess, type ManagedProcess } from './lib/managed-process'
import { assertJfbRevision, readPinnedJfbRevision } from './lib/jfb-revision'
import { benchmarkRunCount, jfbBrowserArguments } from './lib/benchmark-orchestrator'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const TICKER_DIR = resolve(BENCH_DIR, 'jfb-ticker')
const BASELINE = resolve(BENCH_DIR, 'baseline.json')
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
const runs = benchmarkRunCount(args, 1)
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
const candidateDir = process.env.LLUI_BENCH_CANDIDATE_DIR

if (saveBaseline && candidateDir === undefined) {
  console.error('Canonical baselines can only be saved by the complete two-suite transaction.')
  console.error('Run: pnpm bench:all --runs 3 --save')
  process.exit(2)
}

// ── Preflight ───────────────────────────────────────────────────

if (!existsSync(resolve(JFB_REPO, 'webdriver-ts/dist/benchmarkRunner.js'))) {
  console.error('webdriver-ts not compiled. Run `pnpm bench:ticker:setup` first.')
  process.exit(1)
}
assertJfbRevision(JFB_REPO, readPinnedJfbRevision(ROOT))

console.log(`jfb-repo: ${JFB_REPO}`)

// ── Keep the machine awake (macOS) ──
// The ticker suite builds 5 apps then drives Chrome for the full op matrix —
// minutes per pass. An idle/system sleep mid-run skews timings or suspends the
// jfb server and Chrome. Hold a `caffeinate` assertion for the life of this run.
const stopAwake = keepAwake()
let server: ManagedProcess | undefined

function run(command: string, args: readonly string[], cwd: string): void {
  execFileSync(command, [...args], { cwd, stdio: 'inherit' })
}

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

try {
  // ── Build all 5 ticker apps ─────────────────────────────────────

  if (process.env.LLUI_BENCH_WORKSPACE_BUILT !== '1') {
    run(
      'pnpm',
      ['turbo', 'run', 'build', '--filter=@llui/dom...', '--filter=@llui/vite-plugin...'],
      ROOT,
    )
  }

  for (const fw of FRAMEWORKS) {
    console.log(`\n🔨 Building jfb-ticker-${fw}...`)
    run('pnpm', ['run', 'build-prod'], resolve(TICKER_DIR, 'frameworks', fw))
  }

  // ── Ensure the harness registers every op we're about to run ────────────
  // The jfb webdriver harness only measures benchmark ids compiled into it. If the
  // ticker patches are stale — a new op added to the jfb-patches templates but not
  // yet applied, or the jfb repo re-cloned by `bench:setup` (which wipes the
  // patches) — the missing ops run nothing and silently report `—`. Detect that
  // against the COMPILED harness (what actually runs) and re-apply `setup-ticker`
  // automatically so the full suite, batch-1k included, always runs.

  function harnessRegisteredIds(): Set<string> {
    const compiled = resolve(JFB_REPO, 'webdriver-ts/dist/benchmarksWebdriverCDP.js')
    if (!existsSync(compiled)) return new Set()
    const src = readFileSync(compiled, 'utf8')
    return new Set(TICKER_BENCHMARKS.map((b) => b.id).filter((id) => src.includes(id)))
  }

  function missingOps(): string[] {
    const have = harnessRegisteredIds()
    return TICKER_BENCHMARKS.map((b) => b.id).filter((id) => !have.has(id))
  }

  {
    const missing = missingOps()
    if (missing.length > 0) {
      console.log(
        `\n⚙️  Ticker harness is missing ${missing.length} op(s) [${missing.join(', ')}] — ` +
          `applying setup-ticker to register them...`,
      )
      run('pnpm', ['exec', 'tsx', resolve(ROOT, 'scripts/setup-ticker.ts')], ROOT)
      const stillMissing = missingOps()
      if (stillMissing.length > 0) {
        console.error(
          `Ticker harness still missing [${stillMissing.join(', ')}] after setup. ` +
            `Inspect benchmarks/jfb-ticker/jfb-patches/ and run \`pnpm bench:ticker:setup\`.`,
        )
        throw new Error(`Ticker harness is incomplete after setup: ${stillMissing.join(', ')}`)
      }
      console.log('✓ Ticker harness up to date.')
    }
  }

  // ── Start an invocation-owned jfb server ────────────────────────────────
  // We rebuild every app above, so reusing a server from a prior run makes
  // ownership and cleanup ambiguous. Refuse an existing jfb listener and start
  // a fresh process group that this invocation always terminates.

  function curlOk(url: string): boolean {
    try {
      execFileSync('curl', ['-sf', url], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  if (curlOk('http://localhost:8080/ls')) {
    throw new Error(
      'Port 8080 already has a jfb server. Stop it before running a measured capture.',
    )
  }
  console.log('Starting invocation-owned jfb server...')
  server = startManagedProcess('npm', ['start'], { cwd: JFB_REPO, stdio: 'ignore' })
  let ready = false
  for (let i = 0; i < 15; i++) {
    pause(1_000)
    if (curlOk('http://localhost:8080/ls')) {
      ready = true
      break
    }
  }
  if (!ready) {
    throw new Error('jfb server failed to start on port 8080')
  }

  // ── Run benchmarks ──────────────────────────────────────────────

  const webdriverDir = resolve(JFB_REPO, 'webdriver-ts')
  const resultsDir = resolve(webdriverDir, 'results')

  type FwResults = Record<string, Record<string, number | null>>

  const baseline: FwResults = readBenchmarkBaseline(BASELINE).ticker
  const current: FwResults = JSON.parse(JSON.stringify(baseline))
  const measured: BenchmarkMatrix = {}
  const samples = new Map<string, number[]>()

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
    throw new Error('No ticker operations matched --only')
  }
  const benchIdFilter = SELECTED.map((b) => b.id)

  for (let pass = 1; pass <= runs; pass++) {
    if (runs > 1) console.log(`\n=== Pass ${pass}/${runs} ===`)
    for (const fw of toRun) {
      const target = `keyed/${fw}-ticker`
      console.log(`\n🏃 ${target}`)
      prepareFreshResultsDirectory(resultsDir)
      run(
        'node',
        [
          'dist/benchmarkRunner.js',
          '--runner',
          'webdrivercdp',
          '--framework',
          target,
          '--benchmark',
          ...benchIdFilter,
          ...jfbBrowserArguments(headful),
        ],
        webdriverDir,
      )
      const fwName = `${fw}-ticker`
      const fresh = readCompleteBenchmarkResults(
        resultsDir,
        fwName,
        SELECTED.map((benchmark) => benchmark.id),
      )
      for (const b of SELECTED) {
        const m = fresh[b.id]!
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
    measured[fwName] = {}
    for (const b of SELECTED) {
      const arr = samples.get(`${fwName}/${b.id}`) ?? []
      const agg = medianOf(arr)
      if (agg != null) {
        current[fwName][b.id] = agg
        measured[fwName]![b.id] = agg
      }
    }
  }

  // ── Display ─────────────────────────────────────────────────────

  const W = 11
  const LABEL_W = 16
  const cols = FRAMEWORKS.map((f) => `${f}-ticker`)
  console.log('\n=== Ticker results (median ms) ===\n')
  const header = 'Operation'.padEnd(LABEL_W) + cols.map((n) => n.padStart(W)).join('')
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
    assertCompleteTickerBaseline(measured)
    const candidatePath = resolve(candidateDir!, 'ticker.json')
    writeBenchmarkSuiteCandidate(candidatePath, measured)
    console.log(`\n✅ Complete ticker candidate written to ${candidatePath}`)
  }
} finally {
  await server?.stop()
  stopAwake()
}
