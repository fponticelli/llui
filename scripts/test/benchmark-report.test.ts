import { describe, expect, it } from 'vitest'

import { formatBenchmarkMethodology } from '../lib/benchmark-report'

describe('published benchmark methodology', () => {
  it('renders the recorded capture environment instead of a hard-coded machine', () => {
    const methodology = formatBenchmarkMethodology({
      captureId: 'homelab-2026-08-16',
      savedAt: '2026-08-16T20:00:00.000Z',
      machine: 'llui-bench VM — Xeon Gold 6226R, 8 vCPU, 16 GiB RAM',
      browser: 'Chrome 149.0.0',
      headless: true,
      runs: 5,
      cpuIterations: 15,
      memoryIterations: 1,
      sizeIterations: 1,
      gitCommit: '0123456789abcdef',
      jfbCommit: 'fedcba9876543210',
    })

    expect(methodology).toContain('Chrome 149.0.0 (headless)')
    expect(methodology).toContain('5 passes; CPU 15, memory 1, size 1 iterations per pass')
    expect(methodology).toContain('llui-bench VM — Xeon Gold 6226R, 8 vCPU, 16 GiB RAM')
    expect(methodology).toContain('`0123456789ab`')
    expect(methodology).toContain('`fedcba987654`')
    expect(methodology).not.toContain('MacBook Pro')
  })

  it('publishes an explicit warning for migrated legacy provenance', () => {
    const methodology = formatBenchmarkMethodology({
      captureId: 'legacy',
      status: 'legacy',
      note: 'The suites were captured independently and are not one comparable epoch.',
    })

    expect(methodology).toContain(
      '**Legacy capture:** The suites were captured independently and are not one comparable epoch.',
    )
  })
})
