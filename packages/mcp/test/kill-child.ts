import type { ChildProcess } from 'node:child_process'

/** Forcibly terminate a spawned child and wait until it has actually exited.
 *
 * Test teardown must not rely on `SIGTERM`: the llui-mcp CLI's graceful
 * shutdown calls `httpServer.close()`, which blocks on idle keep-alive
 * connections left by the test's `fetch` calls — so the child never exits and
 * the vitest process hangs waiting on its open stdio pipes (observed as a
 * 24-min CI stall on the last test suite, where the container has no init to
 * reap it). `SIGKILL` is uncatchable, so the child dies immediately; we destroy
 * its stdio first so no pipe keeps the event loop alive, then await `exit` with
 * a short safety net. */
export async function killChild(proc: ChildProcess | null): Promise<void> {
  if (!proc) return
  proc.stdout?.destroy()
  proc.stderr?.destroy()
  if (proc.exitCode !== null || proc.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const done = (): void => resolve()
    proc.once('exit', done)
    proc.kill('SIGKILL')
    setTimeout(done, 3000).unref()
  })
}
