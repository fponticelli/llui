/**
 * Self-termination when the process that spawned us disappears (#192).
 *
 * THE FAILURE. A `llui-mcp` CLI spawned non-detached with piped stdio survives
 * its parent's death indefinitely: it is reparented to PID 1 and keeps listening
 * on its bound port. One was found in the wild 31 hours old, still holding a
 * port, executing a `dist/cli.js` whose worktree had been deleted out from under
 * it. Nothing propagates a parent's death to a child on POSIX — the child only
 * ever dies because someone runs teardown, so ANY parent that dies without
 * running it (a SIGKILLed vitest worker, `turbo` aborting the run on another
 * package's failure, an editor stop, a crashed dev server) leaks one.
 *
 * TWO NON-CAUSES, stated because both are the obvious first guess. The tests'
 * `killChild` cannot produce it: SIGKILL on a direct child is uncatchable and
 * its 3 s net only guards a missing `exit` event. And it is not a timeout-budget
 * problem: the budget only decides whether the teardown gets to run, and the
 * orphan is defined by teardown not running at all.
 *
 * WHY A WATCHDOG RATHER THAN GROUP-KILLING FROM THE SPAWNER. Every spawn site
 * would have to remember, and the one that matters most is not a test — the Vite
 * plugin spawns this CLI for `pnpm dev` and hangs its cleanup off
 * `process.once('exit')`, which SIGKILL does not run. A check the CHILD makes
 * covers every spawner, including ones written later, and covers the case where
 * no signal reaches the child at all.
 *
 * `process.ppid` is a live getter (`uv_os_getppid()` per access), not a value
 * captured at startup — measured: a child's `process.ppid` flips to 1 within one
 * poll of its parent being SIGKILLed.
 *
 * THE CARVE-OUT that keeps this from breaking legitimate use: a process
 * DELIBERATELY daemonized (`nohup llui-mcp --http 5200 & disown`) is already
 * parented to init, and exiting because of that would be absurd. So the watch
 * arms only when the ORIGINAL parent was something other than init, and it fires
 * on the parent CHANGING — not on it merely being 1.
 */

export interface ParentWatchOptions {
  /** Live parent-pid read. Injected so the decision logic is testable. */
  readonly getPpid: () => number
  /** Called once, when the original parent is gone. */
  readonly onParentGone: () => void
  /** Poll period. Short enough that a leaked port frees promptly. */
  readonly intervalMs?: number
  /** Escape hatch for a genuinely daemonized launch. */
  readonly disabled?: boolean
  /** Timer injection for tests. */
  readonly schedule?: (fn: () => void, ms: number) => { unref?: () => void }
  readonly cancel?: (handle: unknown) => void
}

/** Stop the watch. Safe to call more than once, and after it has already fired. */
export type StopParentWatch = () => void

/**
 * Decide whether the original parent is gone.
 *
 * Split out from the timer so the rule is checkable without wall-clock: gone
 * means the ppid CHANGED, which on POSIX can only mean reparenting to init.
 * Comparing against 1 directly would be wrong on systems that reparent to a
 * subreaper (a user systemd, a container init) rather than to PID 1.
 */
export function parentIsGone(initialPpid: number, currentPpid: number): boolean {
  return currentPpid !== initialPpid
}

/** Whether a watch should arm at all, given the parent we started under. */
export function shouldWatchParent(initialPpid: number, disabled = false): boolean {
  if (disabled) return false
  // <= 1 means we were started BY init (or the platform does not report a
  // parent). There is no death to observe.
  return Number.isInteger(initialPpid) && initialPpid > 1
}

export function watchParent(options: ParentWatchOptions): StopParentWatch {
  const {
    getPpid,
    onParentGone,
    intervalMs = 1_000,
    disabled = false,
    schedule = (fn, ms) => setInterval(fn, ms),
    cancel = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  } = options

  const initialPpid = getPpid()
  if (!shouldWatchParent(initialPpid, disabled)) return () => undefined

  let fired = false
  const handle = schedule(() => {
    if (fired) return
    if (!parentIsGone(initialPpid, getPpid())) return
    fired = true
    cancel(handle)
    onParentGone()
  }, intervalMs)
  // The watch must never be the reason the process stays alive: a server that
  // has finished its work should still exit on its own.
  handle.unref?.()

  return () => {
    fired = true
    cancel(handle)
  }
}

/** Reads the documented opt-out, so both CLI modes spell it the same way. */
export function parentWatchDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['LLUI_MCP_NO_PARENT_WATCH'] === '1'
}
