// @ts-check

import { resolve } from 'node:path'

export const BENCHMARK_IMAGE = 'llui-benchmark:node24-chrome150'

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
    'type=volume,src=llui-benchmark-jfb,dst=/cache/jfb',
    '--env',
    'CI=1',
    '--env',
    'CHROME_BIN=/opt/chrome/chrome',
    '--env',
    'JFB_REPO=/cache/jfb/repository',
  )
  if (options.machine !== undefined && options.machine !== '') {
    args.push('--env', `LLUI_BENCH_MACHINE=${options.machine}`)
  }
  if (options.smoke) args.push('--env', 'LLUI_BENCH_SMOKE=1')
  args.push(options.image, ...options.benchmarkArgs)
  return args
}
