import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  benchmarkArgsFromCli,
  dockerBuildArgs,
  dockerRunArgs,
  validateBenchmarkPublicationMode,
} from '../lib/benchmark-container.mjs'

describe('benchmark container CLI', () => {
  it('forwards ordinary benchmark arguments without parsing or shell interpretation', () => {
    const args = ['--framework', 'llui with spaces', '--only', 'burst-1k; touch nope']

    expect(benchmarkArgsFromCli(args, {})).toEqual(args)
  })

  it('accepts a JSON argv array from a named environment variable for workflow dispatch', () => {
    expect(
      benchmarkArgsFromCli(['--args-json-env', 'BENCHMARK_ARGS'], {
        BENCHMARK_ARGS: '["--runs","5","--save"]',
      }),
    ).toEqual(['--runs', '5', '--save'])
  })

  it('rejects malformed workflow arguments instead of falling back to shell parsing', () => {
    expect(() =>
      benchmarkArgsFromCli(['--args-json-env', 'BENCHMARK_ARGS'], {
        BENCHMARK_ARGS: '["--runs",5]',
      }),
    ).toThrow('JSON array of strings')
  })

  it('requires workflow publication and --save to agree', () => {
    expect(() => validateBenchmarkPublicationMode(['--runs', '5', '--save'], true)).not.toThrow()
    expect(() => validateBenchmarkPublicationMode(['--runs', '1'], false)).not.toThrow()
    expect(() => validateBenchmarkPublicationMode(['--runs', '5'], true)).toThrow('requires --save')
    expect(() => validateBenchmarkPublicationMode(['--save'], false)).toThrow(
      'requires baseline publication',
    )
  })
})

describe('benchmark Docker invocation', () => {
  it('builds only the pinned benchmark image context', () => {
    expect(dockerBuildArgs('/repo', 'llui-benchmark:test')).toEqual([
      'build',
      '--pull',
      '--tag',
      'llui-benchmark:test',
      '--file',
      resolve('/repo', 'benchmarks/container/Dockerfile'),
      resolve('/repo', 'benchmarks/container'),
    ])
  })

  it('mounts the host-visible checkout and appends benchmark argv unchanged', () => {
    const benchmarkArgs = ['--framework', 'llui with spaces', '--only', 'burst; still-an-arg']

    expect(
      dockerRunArgs({
        image: 'llui-benchmark:test',
        workspaceHost: '/srv/ci-cache/llui benchmark',
        benchmarkArgs,
        cpuSet: '4-7',
        machine: 'ci-runner-01 / isolated CPUs 4-7',
      }),
    ).toEqual([
      'run',
      '--rm',
      '--init',
      '--hostname',
      'llui-benchmark',
      '--shm-size',
      '2g',
      '--cpuset-cpus',
      '4-7',
      '--mount',
      'type=bind,src=/srv/ci-cache/llui benchmark,dst=/workspace',
      '--mount',
      'type=volume,src=llui-benchmark-pnpm,dst=/cache/pnpm',
      '--mount',
      'type=volume,src=llui-benchmark-npm,dst=/cache/npm',
      '--mount',
      'type=volume,src=llui-benchmark-jfb,dst=/workspace/benchmarks/js-framework-benchmark-repo',
      '--env',
      'CI=1',
      '--env',
      'CHROME_BIN=/opt/chrome/chrome',
      '--env',
      'LLUI_BENCH_MACHINE=ci-runner-01 / isolated CPUs 4-7',
      'llui-benchmark:test',
      ...benchmarkArgs,
    ])
  })

  it('uses the same image in smoke mode without forwarding benchmark arguments', () => {
    expect(
      dockerRunArgs({
        image: 'llui-benchmark:test',
        workspaceHost: '/repo',
        benchmarkArgs: [],
        smoke: true,
      }),
    ).toContain('LLUI_BENCH_SMOKE=1')
  })
})

describe('homelab benchmark workflow', () => {
  it('keeps the PID column required by docker top while checking runner arguments', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../.github/workflows/benchmarks-homelab.yml'),
      'utf8',
    )

    expect(workflow).toContain('docker top "$runner" -eo pid,args')
    expect(workflow).not.toContain('docker top "$runner" -eo args')
  })
})
