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
      'type=volume,src=llui-benchmark-jfb,dst=/cache/jfb',
      '--env',
      'CI=1',
      '--env',
      'CHROME_BIN=/opt/chrome/chrome',
      '--env',
      'JFB_REPO=/cache/jfb/repository',
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
  it('drops root before running Chrome without weakening its sandbox', () => {
    const dockerfile = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/Dockerfile'),
      'utf8',
    )
    const entrypoint = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/benchmark-entrypoint.sh'),
      'utf8',
    )
    const privilegeDrop = entrypoint.indexOf('exec setpriv --reuid=node --regid=node --init-groups')
    const chromeCheck = entrypoint.indexOf('assert_version Chrome')

    expect(dockerfile).not.toContain('chmod 4755')
    expect(dockerfile).not.toContain('CHROME_DEVEL_SANDBOX')
    expect(entrypoint).not.toContain('--no-sandbox')
    expect(privilegeDrop).toBeGreaterThan(-1)
    expect(chromeCheck).toBeGreaterThan(privilegeDrop)
  })

  it('delegates to a combined runner that builds current benchmark dependencies first', () => {
    const entrypoint = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/benchmark-entrypoint.sh'),
      'utf8',
    )
    const runner = readFileSync(resolve(import.meta.dirname, '../run-bench-all.ts'), 'utf8')
    const build = runner.indexOf("run('BUILD BENCHMARK DEPENDENCIES'")
    const benchmark = runner.indexOf("run('STANDARD JFB BENCH'")

    expect(build).toBeGreaterThan(-1)
    expect(benchmark).toBeGreaterThan(build)
    expect(entrypoint).toContain('exec pnpm bench:all "$@"')
    expect(entrypoint).not.toContain('pnpm turbo build')
    expect(entrypoint).toContain('pnpm bench:setup\n')
    expect(entrypoint).not.toContain('pnpm bench:setup --force')
  })

  it('installs only the root tooling and benchmark dependency graphs', () => {
    const dockerfile = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/Dockerfile'),
      'utf8',
    )
    const entrypoint = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/container/benchmark-entrypoint.sh'),
      'utf8',
    )

    expect(entrypoint).toContain("--filter 'llui'")
    expect(entrypoint).toContain("--filter 'js-framework-benchmark-keyed-llui...'")
    expect(entrypoint).toContain("--filter 'jfb-ticker-*...'")
    expect(entrypoint).not.toMatch(/^pnpm install --frozen-lockfile --store-dir/m)
    expect(dockerfile).toContain('NPM_CONFIG_UPDATE_NOTIFIER=false')
    expect(dockerfile).toContain('npm install --global --no-audit --no-fund')
  })
})

describe('standard benchmark app', () => {
  it('marks the delegated tbody click listener as presentational', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/js-framework-benchmark/src/main.ts'),
      'utf8',
    )

    expect(source).toMatch(/tbody\(\s*\{[^}]*id: 'tbody',[^}]*role: 'presentation',[^}]*onClick:/)
  })

  it('uses the native Vite 8 single-bundle options without deprecation warnings', () => {
    const config = readFileSync(
      resolve(import.meta.dirname, '../../benchmarks/js-framework-benchmark/vite.config.ts'),
      'utf8',
    )

    expect(config).toContain('rolldownOptions:')
    expect(config).toContain('codeSplitting: false')
    expect(config).not.toContain('rollupOptions:')
    expect(config).not.toContain('inlineDynamicImports:')
  })
})
