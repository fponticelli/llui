import { describe, expect, it } from 'vitest'

import { buildSuiteInvocations } from '../lib/benchmark-orchestrator'

describe('combined benchmark argument forwarding', () => {
  it('preserves every caller argument as an argv element without shell interpretation', () => {
    const args = [
      '--framework',
      'llui with spaces',
      '--only',
      'burst-1k; touch should-not-exist',
      '--runs',
      '2',
    ]

    expect(buildSuiteInvocations(args)).toEqual({ standardArgs: args, tickerArgs: args })
  })

  it('gives both suites the same noise-resistant run count when none is supplied', () => {
    expect(buildSuiteInvocations([])).toEqual({
      standardArgs: ['--all', '--runs', '3'],
      tickerArgs: ['--runs', '3'],
    })
  })

  it('rejects invalid run counts before starting either expensive suite', () => {
    expect(() => buildSuiteInvocations(['--runs', '0'])).toThrow(
      '--runs must be a positive integer',
    )
    expect(() => buildSuiteInvocations(['--runs', 'many'])).toThrow(
      '--runs must be a positive integer',
    )
  })
})
