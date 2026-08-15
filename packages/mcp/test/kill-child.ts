import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** Forcibly terminate a spawned child and wait until it has actually exited.
 *
 * Test teardown must not rely on `SIGTERM`: the llui-mcp CLI's graceful
 * shutdown calls `httpServer.close()`, which blocks on idle keep-alive
 * connections left by the test's `fetch` calls — so the child never exits and
 * the vitest process hangs waiting on its open stdio pipes (observed as a
 * 24-min CI stall on the last test suite, where the container has no init to
 * reap it). `SIGKILL` is uncatchable, so the child dies immediately; we destroy
 * its stdio first so no pipe keeps the event loop alive, then await `exit` with
 * a short safety net.
 *
 * When the child was started by `spawnCli` it is a process-group leader, and we
 * signal the whole GROUP — see the note there. */
export async function killChild(proc: ChildProcess | null): Promise<void> {
  if (!proc) return
  proc.stdout?.destroy()
  proc.stderr?.destroy()
  if (proc.exitCode !== null || proc.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const done = (): void => resolve()
    proc.once('exit', done)
    killGroupOrProcess(proc)
    setTimeout(done, 3000).unref()
  })
}

/**
 * SIGKILL the child's whole process group when we know it leads one, falling
 * back to the child alone.
 *
 * `process.kill(-pid)` targets a group, and getting that wrong is expensive in
 * one direction: on a NON-detached child, `-pid` is not its group — it would
 * signal whatever group happens to carry that id, which for a test runner means
 * vitest and turbo. So the negative form is used ONLY for children this module
 * spawned with `detached: true`, which is exactly the set for which `setsid`
 * guarantees `pgid === pid`.
 */
function killGroupOrProcess(proc: ChildProcess): void {
  if (proc.pid !== undefined && groupLeaders.has(proc)) {
    try {
      process.kill(-proc.pid, 'SIGKILL')
      return
    } catch {
      // ESRCH: the group is already gone. Fall through to the direct kill,
      // which is a no-op in that case too.
    }
  }
  proc.kill('SIGKILL')
}

const groupLeaders = new WeakSet<ChildProcess>()

/**
 * Spawn the built `llui-mcp` CLI for an integration test.
 *
 * `detached: true` is the point (#192): it makes the child a process-group
 * leader, so teardown can reap the CLI AND anything the CLI itself spawned (it
 * can launch a playwright browser) with one group signal. It is the SECOND of
 * two independent guards, not the primary one — the CLI's own parent watchdog
 * (`src/util/parent-watch.ts`) is what covers the case this hook cannot reach,
 * where the parent dies without running teardown at all. Either alone leaves a
 * hole: a watchdog cannot reap the CLI's grandchildren, and a group kill cannot
 * run from a process that has been SIGKILLed.
 *
 * Note `detached` does NOT make the child survive us — it only changes its
 * process group. Nothing here calls `unref()`, so the child stays part of this
 * process's bookkeeping exactly as before.
 */
export function spawnCli(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const proc = spawn(command, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
    detached: true,
  })
  groupLeaders.add(proc)
  return proc
}
