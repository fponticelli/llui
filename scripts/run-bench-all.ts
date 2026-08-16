/**
 * Run the complete standard + ticker benchmark capture.
 *
 * Arguments are forwarded as argv elements to both runners. A canonical save
 * is a transaction: each runner writes a complete candidate into an isolated
 * staging directory, and the single baseline document is replaced only after
 * both candidates validate.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { type BenchmarkMatrix, promoteBenchmarkBaseline } from './lib/benchmark-baseline'
import {
  benchmarkRunCount,
  buildSuiteInvocations,
  captureBenchmarkProvenance,
} from './lib/benchmark-orchestrator'
import { assertJfbRevision, readPinnedJfbRevision } from './lib/jfb-revision'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const BASELINE = resolve(BENCH_DIR, 'baseline.json')
const JFB_REPO = process.env.JFB_REPO
  ? resolve(process.env.JFB_REPO)
  : resolve(BENCH_DIR, 'js-framework-benchmark-repo')
const args = process.argv.slice(2)
const saveBaseline = args.includes('--save')

if (saveBaseline && (args.includes('--framework') || args.includes('--only'))) {
  console.error('Refusing to replace the canonical baseline from a subset run.')
  console.error('Remove --framework/--only, or omit --save for a diagnostic subset.')
  process.exit(2)
}

const invocations = buildSuiteInvocations(args)
if (!existsSync(JFB_REPO)) {
  throw new Error(`JFB checkout not found at ${JFB_REPO}; run pnpm bench:setup first`)
}
assertJfbRevision(JFB_REPO, readPinnedJfbRevision(ROOT))
const provenance = saveBaseline
  ? captureBenchmarkProvenance({
      root: ROOT,
      jfbRepo: JFB_REPO,
      headless: !args.includes('--headful'),
      runs: benchmarkRunCount(args),
    })
  : undefined
if (provenance?.gitDirty) {
  throw new Error('Refusing to save a canonical baseline from a dirty source tree')
}
const candidateDir = saveBaseline
  ? mkdtempSync(resolve(tmpdir(), 'llui-baseline-candidate-'))
  : undefined
const childEnv = {
  ...process.env,
  ...(candidateDir === undefined ? {} : { LLUI_BENCH_CANDIDATE_DIR: candidateDir }),
  LLUI_BENCH_WORKSPACE_BUILT: '1',
}

function run(label: string, command: string, commandArgs: readonly string[]): void {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  ${label}`)
  console.log(`${'═'.repeat(70)}\n`)
  console.log(`$ ${[command, ...commandArgs].join(' ')}\n`)
  execFileSync(command, [...commandArgs], { cwd: ROOT, env: childEnv, stdio: 'inherit' })
}

function readCandidate(name: string): BenchmarkMatrix {
  return JSON.parse(readFileSync(resolve(candidateDir!, `${name}.json`), 'utf8')) as BenchmarkMatrix
}

try {
  run('BUILD BENCHMARK DEPENDENCIES', 'pnpm', [
    'turbo',
    'run',
    'build',
    '--filter=@llui/dom...',
    '--filter=@llui/vite-plugin...',
  ])
  run('STANDARD JFB BENCH', 'pnpm', [
    'exec',
    'tsx',
    resolve(ROOT, 'benchmarks/run-jfb.ts'),
    ...invocations.standardArgs,
  ])
  run('TICKER BENCH', 'pnpm', [
    'exec',
    'tsx',
    resolve(ROOT, 'scripts/run-ticker.ts'),
    ...invocations.tickerArgs,
  ])

  if (saveBaseline) {
    promoteBenchmarkBaseline(BASELINE, {
      provenance: provenance!,
      standard: readCandidate('standard'),
      ticker: readCandidate('ticker'),
    })
    run('REGENERATE PUBLISHED BENCHMARK DATA', 'pnpm', [
      '--filter',
      '@llui/site',
      'exec',
      'tsx',
      'src/generate-benchmarks.ts',
    ])
    console.log(`\n✅ Canonical baseline replaced atomically: ${BASELINE}`)
  }
} finally {
  if (candidateDir !== undefined) rmSync(candidateDir, { recursive: true, force: true })
}

console.log(`\n${'═'.repeat(70)}`)
console.log('  ALL BENCHMARKS COMPLETE')
console.log(`${'═'.repeat(70)}`)
