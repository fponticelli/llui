import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const STANDARD_FRAMEWORKS = [
  'llui',
  'vanillajs',
  'solid',
  'svelte',
  'react-hooks',
  'elm',
] as const

export const STANDARD_BENCHMARK_IDS = [
  '01_run1k',
  '02_replace1k',
  '03_update10th1k_x16',
  '04_select1k',
  '05_swap1k',
  '06_remove-one-1k',
  '07_create10k',
  '08_create1k-after1k_x2',
  '09_clear1k_x8',
  '21_ready-memory',
  '22_run-memory',
  '25_run-clear-memory',
  '41_size-uncompressed',
  '42_size-compressed',
] as const

export const TICKER_FRAMEWORKS = [
  'llui-ticker',
  'vanillajs-ticker',
  'solid-ticker',
  'react-ticker',
  'svelte-ticker',
] as const

export const TICKER_BENCHMARK_IDS = [
  '50_ticker_mount',
  '51_ticker_tick-1',
  '52_ticker_tick-100',
  '53_ticker_burst-1k',
  '54_ticker_narrow-100',
  '55_ticker_wide-toggle',
  '56_ticker_churn-50',
  '57_ticker_clear',
  '58_ticker_batch-1k',
] as const

export type BenchmarkMatrix = Record<string, Record<string, number>>

export interface BenchmarkProvenance {
  readonly captureId: string
  readonly [key: string]: unknown
}

const REQUIRED_PROVENANCE_STRINGS = [
  'captureId',
  'savedAt',
  'machine',
  'platform',
  'browser',
  'nodeVersion',
  'pnpmVersion',
  'lluiVersion',
  'gitCommit',
  'jfbCommit',
] as const

const REQUIRED_PROVENANCE_COUNTS = [
  'runs',
  'cpuIterations',
  'memoryIterations',
  'sizeIterations',
] as const

function assertCompleteProvenance(provenance: BenchmarkProvenance): void {
  if (provenance.status === 'legacy') return
  for (const field of REQUIRED_PROVENANCE_STRINGS) {
    if (typeof provenance[field] !== 'string' || provenance[field] === '') {
      throw new Error(`Benchmark provenance is missing ${field}`)
    }
  }
  for (const field of REQUIRED_PROVENANCE_COUNTS) {
    const value = provenance[field]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`Benchmark provenance has invalid ${field}`)
    }
  }
  for (const field of ['gitDirty', 'headless'] as const) {
    if (typeof provenance[field] !== 'boolean') {
      throw new Error(`Benchmark provenance is missing ${field}`)
    }
  }
  if (provenance.gitDirty) {
    throw new Error('Benchmark provenance is not reproducible: source tree must be clean')
  }
}

export interface BenchmarkBaselineCandidate {
  readonly provenance: BenchmarkProvenance
  readonly standard: BenchmarkMatrix
  readonly ticker: BenchmarkMatrix
}

export interface BenchmarkBaseline extends BenchmarkBaselineCandidate {
  readonly schemaVersion: 1
}

export function assertCompleteStandardBaseline(matrix: BenchmarkMatrix): void {
  assertCompleteMatrix('standard', matrix, STANDARD_FRAMEWORKS, STANDARD_BENCHMARK_IDS)
}

export function assertCompleteTickerBaseline(matrix: BenchmarkMatrix): void {
  assertCompleteMatrix('ticker', matrix, TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS)
}

export function readBenchmarkBaseline(baselinePath: string): BenchmarkBaseline {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BenchmarkBaseline
  if (baseline.schemaVersion !== 1 || typeof baseline.provenance?.captureId !== 'string') {
    throw new Error(`Invalid benchmark baseline schema in ${baselinePath}`)
  }
  assertCompleteProvenance(baseline.provenance)
  assertCompleteStandardBaseline(baseline.standard)
  assertCompleteTickerBaseline(baseline.ticker)
  return baseline
}

export function writeBenchmarkSuiteCandidate(path: string, matrix: BenchmarkMatrix): void {
  writeFileSync(path, JSON.stringify(matrix, null, 2) + '\n', { flag: 'wx' })
}

function assertCompleteMatrix(
  suite: string,
  matrix: BenchmarkMatrix,
  frameworks: readonly string[],
  benchmarks: readonly string[],
): void {
  const missingFrameworks = frameworks.filter((framework) => matrix[framework] === undefined)
  if (missingFrameworks.length > 0) {
    throw new Error(
      `Incomplete ${suite} baseline: missing ${suite} framework(s): ${missingFrameworks.join(', ')}`,
    )
  }

  for (const framework of frameworks) {
    const results = matrix[framework]!
    const missingBenchmarks = benchmarks.filter((benchmark) => results[benchmark] === undefined)
    if (missingBenchmarks.length > 0) {
      throw new Error(
        `Incomplete ${suite} baseline: ${framework} is missing benchmark(s): ${missingBenchmarks.join(', ')}`,
      )
    }
    for (const benchmark of benchmarks) {
      const value = results[benchmark]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Invalid benchmark baseline: ${suite} ${framework}/${benchmark} is not a finite number`,
        )
      }
    }
  }
}

export function promoteBenchmarkBaseline(
  baselinePath: string,
  candidate: BenchmarkBaselineCandidate,
): void {
  assertCompleteProvenance(candidate.provenance)
  assertCompleteStandardBaseline(candidate.standard)
  assertCompleteTickerBaseline(candidate.ticker)

  const tempPath = resolve(dirname(baselinePath), `.${randomUUID()}.baseline.tmp`)
  try {
    writeFileSync(
      tempPath,
      JSON.stringify({ schemaVersion: 1, ...candidate } satisfies BenchmarkBaseline, null, 2) +
        '\n',
      { flag: 'wx' },
    )
    const fd = openSync(tempPath, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tempPath, baselinePath)
    const dirFd = openSync(dirname(baselinePath), 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } finally {
    rmSync(tempPath, { force: true })
  }
}
