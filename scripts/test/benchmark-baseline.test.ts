import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  STANDARD_BENCHMARK_IDS,
  STANDARD_FRAMEWORKS,
  TICKER_BENCHMARK_IDS,
  TICKER_FRAMEWORKS,
  promoteBenchmarkBaseline,
  readBenchmarkBaseline,
} from '../lib/benchmark-baseline'

let dir = ''
let baselinePath = ''

function matrix(frameworks: readonly string[], benchmarks: readonly string[]) {
  return Object.fromEntries(
    frameworks.map((framework, frameworkIndex) => [
      framework,
      Object.fromEntries(
        benchmarks.map((benchmark, index) => [benchmark, frameworkIndex + index + 1]),
      ),
    ]),
  )
}

function provenance() {
  return {
    captureId: 'capture-complete',
    savedAt: '2026-08-16T20:00:00.000Z',
    machine: 'llui-bench VM',
    platform: 'linux 6.8 x64',
    browser: 'Chrome 149.0.0',
    nodeVersion: 'v24.7.0',
    pnpmVersion: '10.33.0',
    lluiVersion: '0.12.1',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    gitDirty: false,
    jfbCommit: 'fedcba9876543210fedcba9876543210fedcba98',
    headless: true,
    runs: 5,
    cpuIterations: 15,
    memoryIterations: 1,
    sizeIterations: 1,
  }
}

beforeEach(() => {
  dir = mkdtempSync(resolve(tmpdir(), 'llui-benchmark-baseline-'))
  baselinePath = resolve(dir, 'baseline.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('canonical benchmark baseline publication', () => {
  it('refuses a subset and leaves the existing baseline byte-for-byte unchanged', () => {
    const original = '{"sentinel":"old baseline"}\n'
    writeFileSync(baselinePath, original)

    expect(() =>
      promoteBenchmarkBaseline(baselinePath, {
        provenance: provenance(),
        standard: matrix(['llui'], STANDARD_BENCHMARK_IDS),
        ticker: matrix(TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS),
      }),
    ).toThrow('standard framework(s): vanillajs, solid, svelte, react-hooks, elm')

    expect(readFileSync(baselinePath, 'utf8')).toBe(original)
    expect(STANDARD_FRAMEWORKS).toContain('llui')
  })

  it('publishes both complete suites as one atomic baseline document', () => {
    promoteBenchmarkBaseline(baselinePath, {
      provenance: { ...provenance(), captureId: 'capture-2', machine: 'homelab' },
      standard: matrix(STANDARD_FRAMEWORKS, STANDARD_BENCHMARK_IDS),
      ticker: matrix(TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS),
    })

    const baseline = readBenchmarkBaseline(baselinePath)
    expect(baseline.schemaVersion).toBe(1)
    expect(baseline.provenance).toEqual({
      ...provenance(),
      captureId: 'capture-2',
      machine: 'homelab',
    })
    expect(baseline.standard.llui?.['01_run1k']).toBe(1)
    expect(baseline.ticker['svelte-ticker']?.['58_ticker_batch-1k']).toBeGreaterThan(0)
  })

  it('rejects non-finite measurements before touching the canonical file', () => {
    const original = '{"sentinel":"still valid"}\n'
    writeFileSync(baselinePath, original)
    const standard = matrix(STANDARD_FRAMEWORKS, STANDARD_BENCHMARK_IDS)
    standard.llui!['01_run1k'] = Number.NaN

    expect(() =>
      promoteBenchmarkBaseline(baselinePath, {
        provenance: provenance(),
        standard,
        ticker: matrix(TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS),
      }),
    ).toThrow('standard llui/01_run1k is not a finite number')
    expect(readFileSync(baselinePath, 'utf8')).toBe(original)
  })

  it('rejects incomplete provenance before replacing a complete measurement matrix', () => {
    expect(() =>
      promoteBenchmarkBaseline(baselinePath, {
        provenance: { captureId: 'capture-without-environment' },
        standard: matrix(STANDARD_FRAMEWORKS, STANDARD_BENCHMARK_IDS),
        ticker: matrix(TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS),
      }),
    ).toThrow('provenance is missing savedAt')
  })

  it('refuses to canonize measurements whose source tree was dirty', () => {
    expect(() =>
      promoteBenchmarkBaseline(baselinePath, {
        provenance: { ...provenance(), gitDirty: true },
        standard: matrix(STANDARD_FRAMEWORKS, STANDARD_BENCHMARK_IDS),
        ticker: matrix(TICKER_FRAMEWORKS, TICKER_BENCHMARK_IDS),
      }),
    ).toThrow('source tree must be clean')
  })
})
