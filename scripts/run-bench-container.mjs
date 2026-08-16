#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BENCHMARK_IMAGE,
  benchmarkArgsFromCli,
  dockerBuildArgs,
  dockerRunArgs,
  validateBenchmarkPublicationMode,
} from './lib/benchmark-container.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliArgs = process.argv.slice(2)
const smoke = cliArgs.length === 1 && cliArgs[0] === '--smoke-image'
const benchmarkArgs = smoke ? [] : benchmarkArgsFromCli(cliArgs, process.env)
const workspaceHost = process.env.LLUI_BENCH_WORKSPACE_HOST ?? root
const publicationMode = process.env.LLUI_BENCH_PUBLISH_BASELINE
if (publicationMode !== undefined) {
  if (publicationMode !== 'true' && publicationMode !== 'false') {
    throw new Error('LLUI_BENCH_PUBLISH_BASELINE must be true or false')
  }
  validateBenchmarkPublicationMode(benchmarkArgs, publicationMode === 'true')
}

/** @param {readonly string[]} args */
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.signal !== null) throw new Error(`docker terminated by ${result.signal}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

docker(dockerBuildArgs(workspaceHost, BENCHMARK_IMAGE))
docker(
  dockerRunArgs({
    image: BENCHMARK_IMAGE,
    workspaceHost,
    benchmarkArgs,
    containerName: process.env.LLUI_BENCH_CONTAINER_NAME,
    cpuSet: process.env.LLUI_BENCH_CPUSET,
    machine: process.env.LLUI_BENCH_MACHINE,
    smoke,
  }),
)
