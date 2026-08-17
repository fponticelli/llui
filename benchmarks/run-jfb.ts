/**
 * Run js-framework-benchmark for LLui and display comparison.
 *
 * Prerequisites:
 *   pnpm bench:setup   # clone + install (root/server/webdriver-ts) + compile
 *
 * Do NOT hand-run the install chain: upstream's root `npm ci` fails with
 * ERESOLVE and takes the two installs the harness actually needs down with
 * it. `scripts/setup-bench.ts` handles that and verifies every step.
 *
 * Usage:
 *   pnpm -w run bench                         # Run LLui only, compare against saved baselines
 *   pnpm -w run bench -- --framework vanillajs # Also re-run vanillajs
 *   pnpm -w run bench -- --all                 # Re-run all frameworks
 *   pnpm -w run bench:all -- --runs 5 --save   # Save a complete canonical baseline
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { keepAwake } from '../scripts/keep-awake'
import {
  type BenchmarkMatrix,
  assertCompleteStandardBaseline,
  readBenchmarkBaseline,
  writeBenchmarkSuiteCandidate,
} from '../scripts/lib/benchmark-baseline'
import {
  prepareFreshResultsDirectory,
  readCompleteBenchmarkResults,
} from '../scripts/lib/benchmark-results'
import { startManagedProcess, type ManagedProcess } from '../scripts/lib/managed-process'
import { assertJfbRevision, readPinnedJfbRevision } from '../scripts/lib/jfb-revision'
import { benchmarkRunCount, jfbBrowserArguments } from '../scripts/lib/benchmark-orchestrator'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const LLUI_APP = resolve(BENCH_DIR, 'js-framework-benchmark')
const BASELINE = resolve(BENCH_DIR, 'baseline.json')
const WORKSPACE_REPO = resolve(BENCH_DIR, 'js-framework-benchmark-repo')

// Use the workspace-embedded pinned checkout unless explicitly overridden.
function detectJfbRepo(): string {
  if (process.env.JFB_REPO) return resolve(process.env.JFB_REPO)
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

// jfb has no plain `keyed/react` framework — the canonical React entry is
// `react-hooks`. Use the real dir name so `--all` doesn't 404 on a phantom.
const COMPETITORS = ['vanillajs', 'solid', 'svelte', 'react-hooks', 'elm']

function run(command: string, args: readonly string[], cwd?: string): void {
  execFileSync(command, [...args], { cwd, stdio: 'inherit' })
}

function curlOk(url: string): boolean {
  try {
    execFileSync('curl', ['-sf', url], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

// ── Parse args ──

const args = process.argv.slice(2)
const saveBaseline = args.includes('--save')
const runAll = args.includes('--all')
const headful = args.includes('--headful')
const extraFrameworks: string[] = []
// Default to 3 runs: a single run is dominated by scheduling/JIT noise, and the
// median-of-medians aggregation below only earns its keep with >1 sample. Three
// is the cheapest count that lets a spurious slow run be outvoted. Override with
// `--runs N`.
const runs = benchmarkRunCount(args)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--framework' && i + 1 < args.length) {
    extraFrameworks.push(args[i + 1]!)
    i++
  } else if (args[i] === '--runs' && i + 1 < args.length) {
    i++
  }
}
const candidateDir = process.env.LLUI_BENCH_CANDIDATE_DIR

if (saveBaseline && candidateDir === undefined) {
  console.error('Canonical baselines can only be saved by the complete two-suite transaction.')
  console.error('Run: pnpm bench:all --runs 3 --save')
  process.exit(2)
}

// ── Preflight checks ──

console.log(`📦 jfb repo: ${JFB_REPO}`)

if (!existsSync(JFB_REPO)) {
  console.error(`ERROR: js-framework-benchmark repo not found at ${WORKSPACE_REPO}.`)
  console.error('Run:\n  pnpm bench:setup')
  process.exit(1)
}

if (!existsSync(resolve(JFB_REPO, 'webdriver-ts/dist/benchmarkRunner.js'))) {
  console.error(`ERROR: webdriver-ts not compiled in ${JFB_REPO}. Run:`)
  console.error('  pnpm bench:setup')
  process.exit(1)
}
assertJfbRevision(JFB_REPO, readPinnedJfbRevision(ROOT))

// ── Keep the machine awake (macOS) ──
// Benchmark runs are long; an idle/display/system sleep mid-run skews timings or
// kills the run. Hold a `caffeinate` assertion for the life of this process.
const stopAwake = keepAwake()
let server: ManagedProcess | undefined

try {
  // ── Build LLui ──

  console.log('\n🔨 Building LLui benchmark app...')
  if (process.env.LLUI_BENCH_WORKSPACE_BUILT !== '1') {
    run(
      'pnpm',
      ['turbo', 'run', 'build', '--filter=@llui/dom...', '--filter=@llui/vite-plugin...'],
      ROOT,
    )
  }
  run('pnpm', ['build-prod'], LLUI_APP)

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

  // The pinned jfb server's `/ls` only lists frameworks that have a package-lock.json
  // (it derives installed versions from the lockfile). Without it the framework
  // is silently absent from discovery, `--framework keyed/llui` matches nothing,
  // and every benchmark "succeeds" in 0.00 ms with no results — the comparison
  // then echoes the baseline back as Current (all +0%). Write a minimal lockfile.
  if (!existsSync(resolve(jfbLluiDir, 'package-lock.json'))) {
    writeFileSync(
      resolve(jfbLluiDir, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'js-framework-benchmark-keyed-llui',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'js-framework-benchmark-keyed-llui', version: '1.0.0' },
          },
        },
        null,
        2,
      ) + '\n',
    )
  }

  // ── Start an invocation-owned server ──

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
    throw new Error(
      `jfb server failed to start. Verify ${JFB_REPO}/server/node_modules with pnpm bench:setup`,
    )
  }

  // ── Determine which frameworks to run ──

  const frameworksToRun = ['keyed/llui']
  const seen = new Set(frameworksToRun)
  const pushUnique = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name)
      frameworksToRun.push(name)
    }
  }
  if (runAll) {
    for (const fw of COMPETITORS) pushUnique(`keyed/${fw}`)
  } else {
    for (const fw of extraFrameworks) pushUnique(`keyed/${fw}`)
  }

  // ── Run benchmarks ──

  const webdriverDir = resolve(JFB_REPO, 'webdriver-ts')
  const resultsDir = resolve(webdriverDir, 'results')

  type FwResults = Record<string, Record<string, number | null>>

  const baseline: FwResults = readBenchmarkBaseline(BASELINE).standard

  // Current = baseline seed for frameworks we didn't re-run, overlayed with fresh results.
  const current: FwResults = JSON.parse(JSON.stringify(baseline))
  const measured: BenchmarkMatrix = {}

  // Accumulate medians from each run for each fw×benchmark.
  const samples = new Map<string, number[]>() // key: "fw/benchmarkId"

  function medianOf(nums: number[]): number | null {
    if (nums.length === 0) return null
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  }

  // Explicit benchmark filter: the ticker bench (`bench:ticker:setup`)
  // registers ticker IDs in jfb's global benchmarks array. Without a
  // filter the runner attempts them against the standard `keyed/llui`
  // app, which lacks ticker buttons → 8 fast failures per framework.
  const benchmarkFilter = ALL_BENCHMARKS.map((b) => b.id)

  for (let pass = 1; pass <= runs; pass++) {
    if (runs > 1) console.log(`\n=== Pass ${pass}/${runs} ===`)
    for (const fw of frameworksToRun) {
      console.log(`\n🏃 Running benchmark: ${fw}...`)
      prepareFreshResultsDirectory(resultsDir)
      run(
        'node',
        [
          'dist/benchmarkRunner.js',
          '--framework',
          fw,
          '--benchmark',
          ...benchmarkFilter,
          ...jfbBrowserArguments(headful),
        ],
        webdriverDir,
      )
      const fwName = fw.replace('keyed/', '')
      const fresh = readCompleteBenchmarkResults(
        resultsDir,
        fwName,
        ALL_BENCHMARKS.map((benchmark) => benchmark.id),
      )
      for (const b of ALL_BENCHMARKS) {
        const m = fresh[b.id]!
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
    measured[fwName] = {}
    for (const b of ALL_BENCHMARKS) {
      const arr = samples.get(`${fwName}/${b.id}`) ?? []
      const agg = medianOf(arr)
      if (agg != null) {
        current[fwName][b.id] = agg
        measured[fwName]![b.id] = agg
      }
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
    assertCompleteStandardBaseline(measured)
    const candidatePath = resolve(candidateDir!, 'standard.json')
    writeBenchmarkSuiteCandidate(candidatePath, measured)
    console.log(`\n✅ Complete standard candidate written to ${candidatePath}`)
  }
} finally {
  await server?.stop()
  stopAwake()
}

console.log()
