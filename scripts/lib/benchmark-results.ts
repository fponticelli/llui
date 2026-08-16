import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

interface HarnessResult {
  readonly framework?: unknown
  readonly benchmark?: unknown
  readonly values?: {
    readonly total?: { readonly median?: unknown }
    readonly DEFAULT?: { readonly median?: unknown }
  }
}

export function prepareFreshResultsDirectory(resultsDir: string): void {
  rmSync(resultsDir, { recursive: true, force: true })
  mkdirSync(resultsDir, { recursive: true })
}

export function readCompleteBenchmarkResults(
  resultsDir: string,
  framework: string,
  benchmarkIds: readonly string[],
): Record<string, number> {
  const requested = new Set(benchmarkIds)
  const found = new Map<string, number>()

  for (const file of readdirSync(resultsDir).filter((name) => name.endsWith('.json'))) {
    const result = JSON.parse(readFileSync(resolve(resultsDir, file), 'utf8')) as HarnessResult
    if (
      typeof result.framework !== 'string' ||
      !result.framework.startsWith(`${framework}-`) ||
      typeof result.benchmark !== 'string' ||
      !requested.has(result.benchmark)
    ) {
      continue
    }

    const median = result.values?.total?.median ?? result.values?.DEFAULT?.median
    if (typeof median !== 'number' || !Number.isFinite(median)) {
      throw new Error(
        `Malformed ${framework} benchmark result: invalid median for ${result.benchmark}`,
      )
    }
    if (found.has(result.benchmark)) {
      throw new Error(`Ambiguous ${framework} benchmark result: duplicate ${result.benchmark}`)
    }
    found.set(result.benchmark, median)
  }

  const missing = benchmarkIds.filter((id) => !found.has(id))
  if (missing.length > 0) {
    throw new Error(`Incomplete ${framework} benchmark result: missing ${missing.join(', ')}`)
  }

  return Object.fromEntries(benchmarkIds.map((id) => [id, found.get(id)!]))
}
