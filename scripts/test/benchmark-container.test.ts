import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { dockerBuildArgs, dockerRunArgs } from '../lib/benchmark-container.mjs'

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

describe('benchmark container entrypoint', () => {
  it('builds workspace dist outputs before executing either benchmark suite', () => {
    const entrypoint = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/benchmark-entrypoint.sh'),
      'utf8',
    )
    const build = entrypoint.indexOf('pnpm turbo build')
    const benchmark = entrypoint.indexOf('exec pnpm bench:all "$@"')

    expect(build).toBeGreaterThan(-1)
    expect(benchmark).toBeGreaterThan(build)
    expect(entrypoint).toContain('pnpm bench:setup\n')
    expect(entrypoint).not.toContain('pnpm bench:setup --force')
  })
})
