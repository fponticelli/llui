import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

export interface ManagedChild {
  readonly pid: number
}

export interface ManagedProcess extends ManagedChild {
  stop(): Promise<void>
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
  }
  return child.exitCode !== null || child.signalCode !== null
}

async function stopTree(child: ChildProcess): Promise<void> {
  signalTree(child, 'SIGTERM')
  if (await waitForExit(child, 2_000)) return
  signalTree(child, 'SIGKILL')
  await waitForExit(child, 2_000)
}

export async function withManagedProcess<T>(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  body: (child: ManagedChild) => Promise<T>,
): Promise<T> {
  const managed = startManagedProcess(command, args, options)
  try {
    return await body(managed)
  } finally {
    await managed.stop()
  }
}

export function startManagedProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ManagedProcess {
  const child = spawn(command, [...args], {
    ...options,
    detached: process.platform !== 'win32',
  })
  if (child.pid === undefined) {
    throw new Error(`Failed to start managed process: ${command}`)
  }

  let stopped = false
  const exitListener = () => signalTree(child, 'SIGKILL')
  const signalListeners = new Map<NodeJS.Signals, () => void>()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const listener = () => {
      signalTree(child, 'SIGTERM')
      process.off(signal, listener)
      process.kill(process.pid, signal)
    }
    signalListeners.set(signal, listener)
    process.once(signal, listener)
  }
  process.once('exit', exitListener)

  return {
    pid: child.pid,
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      process.off('exit', exitListener)
      for (const [signal, listener] of signalListeners) process.off(signal, listener)
      await stopTree(child)
    },
  }
}
