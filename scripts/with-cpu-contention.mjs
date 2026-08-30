#!/usr/bin/env node

import { availableParallelism } from 'node:os'
import { spawn } from 'node:child_process'

const separator = process.argv.indexOf('--')
const command = process.argv[separator + 1]
const args = process.argv.slice(separator + 2)

if (separator === -1 || command === undefined) {
  console.error('Usage: node scripts/with-cpu-contention.mjs -- <command> [args...]')
  process.exitCode = 2
} else {
  const configuredWorkers = process.env['LLUI_CPU_CONTENTION_WORKERS']
  const workerCount = configuredWorkers === undefined ? availableParallelism() : +configuredWorkers
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new Error('LLUI_CPU_CONTENTION_WORKERS must be a positive integer')
  }

  const spinners = Array.from({ length: workerCount }, () => {
    const child = spawn(process.execPath, ['--eval', 'for (;;) { Math.imul(17, 23) }'], {
      stdio: 'ignore',
    })
    const stopped = new Promise((resolve) => child.once('exit', resolve))
    return { child, stopped }
  })

  /** @type {import('node:child_process').ChildProcess | undefined} */
  let testProcess
  /** @param {NodeJS.Signals} signal */
  const forwardSignal = (signal) => {
    testProcess?.kill(signal)
    for (const spinner of spinners) spinner.child.kill(signal)
  }
  const onInterrupt = () => forwardSignal('SIGINT')
  const onTerminate = () => forwardSignal('SIGTERM')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)

  try {
    console.error(`Running under ${workerCount} CPU contention workers`)
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    testProcess = child
    /** @type {Promise<{ code: number | null, signal: NodeJS.Signals | null }>} */
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    const result = await exited
    process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : 143)
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    for (const spinner of spinners) spinner.child.kill('SIGTERM')
    await Promise.all(spinners.map((spinner) => spinner.stopped))
  }
}
