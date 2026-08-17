import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os'
import { resolve } from 'node:path'

import type { BenchmarkProvenance } from './benchmark-baseline'
import { currentJfbRevision } from './jfb-revision'

export interface SuiteInvocations {
  readonly standardArgs: readonly string[]
  readonly tickerArgs: readonly string[]
}

export function benchmarkRunCount(args: readonly string[], defaultRuns = 3): number {
  const indexes = args.flatMap((arg, index) => (arg === '--runs' ? [index] : []))
  if (indexes.length === 0) return defaultRuns
  if (indexes.length > 1) throw new Error('--runs may only be specified once')
  const raw = args[indexes[0]! + 1]
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
    throw new Error('--runs must be a positive integer')
  }
  const runs = Number(raw)
  if (!Number.isSafeInteger(runs)) throw new Error('--runs must be a positive integer')
  return runs
}

export function buildSuiteInvocations(args: readonly string[]): SuiteInvocations {
  const runs = benchmarkRunCount(args)
  const forwarded = args.includes('--runs') ? [...args] : [...args, '--runs', String(runs)]
  return {
    standardArgs:
      args.includes('--framework') || args.includes('--all') ? forwarded : ['--all', ...forwarded],
    tickerArgs: [...forwarded],
  }
}

export function jfbBrowserArguments(
  headful: boolean,
  chromeBinary: string | undefined = process.env.CHROME_BIN,
): string[] {
  return [
    ...(headful ? [] : ['--headless']),
    ...(chromeBinary ? ['--chromeBinary', chromeBinary] : []),
  ]
}

const JFB_RESULT_TO_RUNNER_BENCHMARK: Readonly<Record<string, string>> = {
  '41_size-uncompressed': '40_sizes',
  '42_size-compressed': '40_sizes',
}

/**
 * Translate expected result IDs into the upstream runner IDs that produce
 * them. JFB's size runner is an aggregate: selecting `40_sizes` emits the
 * `41_size-uncompressed` and `42_size-compressed` result files.
 */
export function jfbBenchmarkSelection(expectedResultIds: readonly string[]): string[] {
  const selected: string[] = []
  const seen = new Set<string>()
  for (const resultId of expectedResultIds) {
    const runnerId = JFB_RESULT_TO_RUNNER_BENCHMARK[resultId] ?? resultId
    if (!seen.has(runnerId)) {
      seen.add(runnerId)
      selected.push(runnerId)
    }
  }
  return selected
}

function output(command: string, args: readonly string[], cwd?: string): string {
  return execFileSync(command, [...args], { cwd, encoding: 'utf8' }).trim()
}

function browserVersion(): string {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((candidate): candidate is string => candidate !== undefined)

  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue
    try {
      return output(candidate, ['--version'])
    } catch {
      // Try the next supported Chrome/Chromium executable name.
    }
  }
  throw new Error('Could not determine the Chrome/Chromium version used by the benchmark harness')
}

export function captureBenchmarkProvenance(options: {
  readonly root: string
  readonly jfbRepo: string
  readonly headless: boolean
  readonly runs: number
}): BenchmarkProvenance {
  const cpu = cpus()[0]?.model ?? 'unknown CPU'
  const memoryGiB = Math.round(totalmem() / 1024 ** 3)
  const gitStatus = output('git', ['status', '--porcelain', '--untracked-files=all'], options.root)
  const domPackage = JSON.parse(
    readFileSync(resolve(options.root, 'packages/dom/package.json'), 'utf8'),
  ) as { version?: unknown }
  if (typeof domPackage.version !== 'string' || domPackage.version === '') {
    throw new Error('packages/dom/package.json has no valid version')
  }

  return {
    captureId: randomUUID(),
    savedAt: new Date().toISOString(),
    machine:
      process.env.LLUI_BENCH_MACHINE ??
      `${hostname()} — ${cpu}, ${cpus().length} logical CPUs, ${memoryGiB} GiB RAM`,
    platform: `${platform()} ${release()} ${arch()}`,
    browser: browserVersion(),
    nodeVersion: process.version,
    pnpmVersion: output('pnpm', ['--version'], options.root),
    lluiVersion: domPackage.version,
    gitCommit: output('git', ['rev-parse', 'HEAD'], options.root),
    gitDirty: gitStatus !== '',
    jfbCommit: currentJfbRevision(options.jfbRepo),
    headless: options.headless,
    runs: options.runs,
    cpuIterations: 15,
    memoryIterations: 1,
    sizeIterations: 1,
  }
}
