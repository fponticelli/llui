/**
 * Keep the machine awake for the duration of a long benchmark run (macOS).
 *
 * Benchmark runs are long; an idle/display/system sleep mid-run skews timings —
 * or kills the run outright (the jfb server and Chrome get suspended). On macOS
 * we hold a `caffeinate` process with `-disu` so the OS won't display-sleep,
 * idle-sleep, system-sleep, or treat the user as idle. `-w <pid>` makes that
 * process watch ours and auto-exit when we do — including on crash — and we also
 * register an `exit` handler to kill it explicitly for good measure.
 *
 * No-op on non-darwin platforms, and degrades silently if `caffeinate` is
 * missing or fails to spawn. Returns a `stop()` to release the assertion early;
 * it is idempotent and safe to call more than once.
 */
import { spawn, type ChildProcess } from 'node:child_process'

export function keepAwake(): () => void {
  if (process.platform !== 'darwin') return () => {}

  let proc: ChildProcess | undefined
  try {
    proc = spawn('caffeinate', ['-disu', '-w', String(process.pid)], {
      stdio: 'ignore',
      detached: false,
    })
    proc.on('error', () => {
      proc = undefined
    })
  } catch {
    proc = undefined
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    if (proc && !proc.killed) proc.kill()
    proc = undefined
  }
  process.on('exit', stop)
  return stop
}
