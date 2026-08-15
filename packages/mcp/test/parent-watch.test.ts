import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  parentIsGone,
  parentWatchDisabled,
  shouldWatchParent,
  watchParent,
} from '../src/util/parent-watch'

/**
 * Cover for the PID-1 orphan guard (#192).
 *
 * The unit half pins the decision rules (they are the part that can silently
 * become wrong); the integration half is the one that actually proves the bug is
 * dead, because the bug is defined by a process surviving — which no amount of
 * mocked timers can demonstrate.
 */

describe('shouldWatchParent', () => {
  it('arms under a normal parent', () => {
    expect(shouldWatchParent(4242)).toBe(true)
  })

  it('does NOT arm when the process was started by init', () => {
    // A launchd/systemd service, or anything already re-parented when it execs.
    // There is no parent death left to observe.
    expect(shouldWatchParent(1)).toBe(false)
    expect(shouldWatchParent(0)).toBe(false)
  })

  it('DOES arm under a shell, which is why the env opt-out exists', () => {
    // `nohup … & disown` from a live shell does NOT reparent — `disown` only
    // drops the job from the shell's table — so the ppid is the shell and the
    // watch arms. When that shell exits, this server would shut itself down,
    // contrary to what `nohup` was asking for. Documented, and covered ONLY by
    // the opt-out; asserted here so the carve-out cannot be re-described as
    // handling it.
    const shellPid = 4242
    expect(shouldWatchParent(shellPid)).toBe(true)
    expect(
      shouldWatchParent(shellPid, parentWatchDisabled({ LLUI_MCP_NO_PARENT_WATCH: '1' })),
    ).toBe(false)
  })

  it('honors the documented opt-out', () => {
    expect(shouldWatchParent(4242, true)).toBe(false)
    expect(parentWatchDisabled({ LLUI_MCP_NO_PARENT_WATCH: '1' })).toBe(true)
    expect(parentWatchDisabled({})).toBe(false)
    expect(parentWatchDisabled({ LLUI_MCP_NO_PARENT_WATCH: '0' })).toBe(false)
  })
})

describe('parentIsGone', () => {
  it('fires on the ppid CHANGING, not on it being 1', () => {
    // Reparenting is to PID 1 on a plain POSIX host but to a SUBREAPER under a
    // user systemd or a container init, so `=== 1` would silently never fire
    // there. The change itself is the observable fact.
    expect(parentIsGone(4242, 1)).toBe(true)
    expect(parentIsGone(4242, 907)).toBe(true)
    expect(parentIsGone(4242, 4242)).toBe(false)
  })
})

describe('watchParent', () => {
  it('fires once when the parent changes, then stops polling', () => {
    let ppid = 4242
    let gone = 0
    const ticks: (() => void)[] = []
    let cancelled = false
    const stop = watchParent({
      getPpid: () => ppid,
      onParentGone: () => gone++,
      schedule: (fn) => {
        ticks.push(fn)
        return { unref: () => undefined }
      },
      cancel: () => {
        cancelled = true
      },
    })
    const tick = ticks[0]!
    tick()
    expect(gone).toBe(0)
    ppid = 1
    tick()
    expect(gone).toBe(1)
    expect(cancelled).toBe(true)
    tick()
    expect(gone).toBe(1)
    stop()
  })

  it('schedules nothing at all when it does not arm', () => {
    let scheduled = 0
    watchParent({
      getPpid: () => 1,
      onParentGone: () => undefined,
      schedule: () => {
        scheduled++
        return {}
      },
    })
    expect(scheduled).toBe(0)
  })

  it('unrefs its timer so it can never be the reason the process stays up', () => {
    let unreffed = false
    watchParent({
      getPpid: () => 4242,
      onParentGone: () => undefined,
      schedule: () => ({
        unref: () => {
          unreffed = true
        },
      }),
    })
    expect(unreffed).toBe(true)
  })

  it('stop() prevents a later tick from firing', () => {
    let ppid = 4242
    let gone = 0
    const ticks: (() => void)[] = []
    const stop = watchParent({
      getPpid: () => ppid,
      onParentGone: () => gone++,
      schedule: (fn) => {
        ticks.push(fn)
        return { unref: () => undefined }
      },
      cancel: () => undefined,
    })
    stop()
    ppid = 1
    ticks[0]!()
    expect(gone).toBe(0)
  })
})

/**
 * The real thing. Reproduces #192's exact recipe — spawn `dist/cli.js --http 0`
 * non-detached with piped stdio, then SIGKILL the parent WITHOUT running any
 * teardown — and asserts the CLI is gone rather than reparented to PID 1 and
 * still listening. Before the watchdog this child survived indefinitely; one was
 * found 31 h old, outliving the worktree whose `dist/cli.js` it was running.
 *
 * The grandparent indirection is not incidental: SIGKILLing THIS process is not
 * an option, so a throwaway node process plays the parent that dies badly.
 */
describe('llui-mcp orphan guard (integration)', () => {
  it('exits when its parent dies without running teardown', async () => {
    const cliPath = resolve(__dirname, '../dist/cli.js')
    // The grandparent spawns the CLI exactly the way the leaking call sites do,
    // prints the child pid, then blocks forever with no exit handler of any kind.
    const parentScript = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, [${JSON.stringify(cliPath)}, '--http', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      process.stdout.write('CHILD ' + child.pid + '\\n')
      setInterval(() => {}, 1000)
    `
    const parent = spawn(process.execPath, ['-e', parentScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let childPid = 0
    try {
      let out = ''
      parent.stdout?.on('data', (b: Buffer) => (out += b.toString()))
      for (let i = 0; i < 200 && childPid === 0; i++) {
        const match = /CHILD (\d+)/.exec(out)
        if (match) childPid = Number(match[1])
        else await delay(50)
      }
      expect(childPid).toBeGreaterThan(0)
      // Let the CLI get far enough to bind and arm its watch.
      await delay(1_500)
      expect(isAlive(childPid)).toBe(true)

      parent.kill('SIGKILL')

      // The watch polls at 1 s; give it generous room under parallel load.
      let exited = false
      for (let i = 0; i < 200; i++) {
        if (!isAlive(childPid)) {
          exited = true
          break
        }
        await delay(100)
      }
      expect(exited, `pid ${childPid} survived its parent's death`).toBe(true)
    } finally {
      parent.stdout?.destroy()
      parent.stderr?.destroy()
      parent.kill('SIGKILL')
      // Belt and braces: never let THIS test be the thing that leaks an orphan.
      if (childPid > 0 && isAlive(childPid)) {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
  }, 30_000)
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}
