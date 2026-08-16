import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  prepareFreshResultsDirectory,
  readCompleteBenchmarkResults,
} from '../lib/benchmark-results'

let resultsDir = ''

function writeResult(file: string, framework: string, benchmark: string, median: number): void {
  writeFileSync(
    resolve(resultsDir, file),
    JSON.stringify({ framework, benchmark, values: { total: { median } } }),
  )
}

beforeEach(() => {
  resultsDir = mkdtempSync(resolve(tmpdir(), 'llui-benchmark-results-'))
  mkdirSync(resultsDir, { recursive: true })
})

afterEach(() => {
  rmSync(resultsDir, { recursive: true, force: true })
})

describe('fresh benchmark result capture', () => {
  it('returns one valid median for every requested benchmark', () => {
    writeResult('llui-v1-keyed_01_run1k.json', 'llui-v1-keyed', '01_run1k', 12.5)
    writeResult('llui-v1-keyed_21_ready-memory.json', 'llui-v1-keyed', '21_ready-memory', 1.25)

    expect(
      readCompleteBenchmarkResults(resultsDir, 'llui', ['01_run1k', '21_ready-memory']),
    ).toEqual({ '01_run1k': 12.5, '21_ready-memory': 1.25 })
  })

  it('rejects an incomplete invocation instead of allowing old baseline values to fill gaps', () => {
    writeResult('llui-v1-keyed_01_run1k.json', 'llui-v1-keyed', '01_run1k', 12.5)

    expect(() =>
      readCompleteBenchmarkResults(resultsDir, 'llui', ['01_run1k', '02_replace1k']),
    ).toThrow('missing 02_replace1k')
  })

  it('rejects ambiguous duplicate files rather than choosing one by directory order', () => {
    writeResult('first.json', 'llui-v1-keyed', '01_run1k', 12.5)
    writeResult('second.json', 'llui-v1-keyed', '01_run1k', 99)

    expect(() => readCompleteBenchmarkResults(resultsDir, 'llui', ['01_run1k'])).toThrow(
      'duplicate 01_run1k',
    )
  })

  it('names a malformed measurement instead of treating it as merely absent', () => {
    writeResult('bad.json', 'llui-v1-keyed', '01_run1k', Number.NaN)

    expect(() => readCompleteBenchmarkResults(resultsDir, 'llui', ['01_run1k'])).toThrow(
      'invalid median for 01_run1k',
    )
  })

  it('starts every harness invocation with an empty result directory', () => {
    writeResult('stale.json', 'llui-v0-keyed', '01_run1k', 999)

    prepareFreshResultsDirectory(resultsDir)

    expect(() => readCompleteBenchmarkResults(resultsDir, 'llui', ['01_run1k'])).toThrow(
      'missing 01_run1k',
    )
  })
})
