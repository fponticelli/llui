// @ts-check

import { resolve } from 'node:path'

export const BENCHMARK_IMAGE = 'llui-benchmark:node24-chrome150'

/**
 * Decode workflow-dispatch arguments without asking a shell to interpret them.
 * Ordinary callers receive exact argv forwarding; Actions supplies a JSON array
 * through a named environment variable because workflow inputs are strings.
 *
 * @param {readonly string[]} cliArgs
 * @param {Readonly<Record<string, string | undefined>>} environment
 * @returns {string[]}
 */
export function benchmarkArgsFromCli(cliArgs, environment) {
  if (cliArgs[0] !== '--args-json-env') return [...cliArgs]
  if (cliArgs.length !== 2 || cliArgs[1] === undefined) {
    throw new Error('--args-json-env requires exactly one environment-variable name')
  }

  const variable = cliArgs[1]
  const raw = environment[variable]
  if (raw === undefined) throw new Error(`${variable} is not set`)

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${variable} must be a JSON array of strings`, { cause: error })
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'string')) {
    throw new Error(`${variable} must be a JSON array of strings`)
  }
  return parsed
}

/**
 * Keep workflow intent and benchmark mutation semantics aligned. A diagnostic
 * run must never produce an unpublished canonical baseline, and publication
 * must never silently run without the transaction flag.
 *
 * @param {readonly string[]} benchmarkArgs
 * @param {boolean} publishBaseline
 */
export function validateBenchmarkPublicationMode(benchmarkArgs, publishBaseline) {
  const saves = benchmarkArgs.includes('--save')
  if (publishBaseline && !saves) {
    throw new Error('Baseline publication requires --save in the benchmark argv')
  }
  if (!publishBaseline && saves) {
    throw new Error('--save requires baseline publication to be enabled')
  }
}

/**
 * @param {string} root
 * @param {string} image
 * @returns {string[]}
 */
export function dockerBuildArgs(root, image) {
  const context = resolve(root, 'benchmarks/container')
  return ['build', '--pull', '--tag', image, '--file', resolve(context, 'Dockerfile'), context]
}

/**
 * @typedef {object} DockerRunOptions
 * @property {string} image
 * @property {string} workspaceHost
 * @property {readonly string[]} benchmarkArgs
 * @property {string | undefined} [containerName]
 * @property {string | undefined} [cpuSet]
 * @property {string | undefined} [machine]
 * @property {boolean | undefined} [smoke]
 */

/**
 * @param {DockerRunOptions} options
 * @returns {string[]}
 */
export function dockerRunArgs(options) {
  const args = ['run', '--rm', '--init', '--hostname', 'llui-benchmark', '--shm-size', '2g']
  if (options.containerName !== undefined && options.containerName !== '') {
    args.push('--name', options.containerName)
  }
  if (options.cpuSet !== undefined && options.cpuSet !== '') {
    args.push('--cpuset-cpus', options.cpuSet)
  }
  args.push(
    '--mount',
    `type=bind,src=${options.workspaceHost},dst=/workspace`,
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
  )
  if (options.machine !== undefined && options.machine !== '') {
    args.push('--env', `LLUI_BENCH_MACHINE=${options.machine}`)
  }
  if (options.smoke) args.push('--env', 'LLUI_BENCH_SMOKE=1')
  args.push(options.image, ...options.benchmarkArgs)
  return args
}
