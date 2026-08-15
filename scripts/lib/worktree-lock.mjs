import { mkdirSync, writeFileSync, readFileSync, linkSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'

/**
 * A cross-worktree mutual-exclusion lock.
 *
 * WHY THIS EXISTS (issue #179). `git stash` writes a SINGLE ref — `refs/stash`
 * on the COMMON git dir — that every worktree of a repository shares. The
 * lint-staged pre-commit hook uses it (measured: `stash create` → `stash store`
 * → `stash list` → `stash drop --quiet <n>`), and `<n>` is an INDEX resolved
 * from that `stash list` and then used in a SEPARATE git invocation. A lane that
 * pushes or drops in between shifts every index, so the second call operates on
 * somebody else's entry — demonstrated: lane A resolves its own backup to index
 * 0, another worktree's hook stores one, and A's `drop 0` deletes THAT while A's
 * leaks onto the stack. The error path is worse: `stash apply --index <n>`
 * against a shifted index restores a foreign lane's working tree into this one.
 * Two lanes destroyed each other's entries in one batch of parallel agent work;
 * both recovered by hand.
 *
 * The hazard is mutual exclusion missing on a shared resource, so the fix is a
 * lock — and it must live on the SAME shared dir the ref does (the common git
 * dir), or worktrees would each take their own and exclude nothing.
 *
 * `linkSync` is the primitive, NOT `openSync(path, 'wx')`, and the difference is
 * load-bearing. Both are atomic creates, but `wx` leaves the lock file EMPTY
 * between the create and the write of its record — and a contender that reads it
 * in that window sees unparseable content, concludes the lock is abandoned, and
 * steals it from a holder that is very much alive. That is not theoretical: the
 * first draft of this file used `wx` and the six-process test below caught two
 * workers inside the critical section at once. `link(2)` closes the window by
 * construction — the record is written to a private temp file FIRST and only
 * then linked into place, so a lock is never visible without its contents, and
 * `link` still fails with EEXIST when the target exists. Stealing a stale lock
 * goes through `renameSync`, also atomic, so two simultaneous stealers cannot
 * both proceed — the loser's rename fails and it goes back round the loop.
 */

/** @typedef {{ pid: number, host: string, token: string, startedAt: number, label: string }} LockRecord */

/**
 * @typedef {object} AcquireOptions
 * @property {number} [timeoutMs]  Give up waiting after this long. Default 300_000.
 * @property {number} [staleMs]    Treat a lock older than this as abandoned. Default 600_000.
 * @property {number} [pollMs]     Delay between attempts. Default 50.
 * @property {string} [label]      Free text recorded in the lock, shown when waiting.
 * @property {() => number} [now]  Clock, injectable for tests.
 * @property {(pid: number) => boolean} [isAlive] Liveness probe, injectable for tests.
 * @property {(ms: number) => Promise<void>} [sleep] Delay, injectable for tests.
 * @property {(message: string) => void} [onWait] Called once when the first wait starts.
 */

/** Default liveness probe: signal 0 tests for existence without delivering anything. */
export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to another user — still alive.
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM'
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Read the record a lock file holds. Returns null when the file is gone or its
 * contents are not a record we wrote — an unreadable lock is indistinguishable
 * from an abandoned one, and both want the same treatment (steal it).
 * @param {string} lockPath
 * @returns {LockRecord | null}
 */
function readLock(lockPath) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { pid, host, token, startedAt, label } = /** @type {Record<string, unknown>} */ (parsed)
    if (typeof pid !== 'number' || typeof host !== 'string' || typeof token !== 'string')
      return null
    if (typeof startedAt !== 'number') return null
    return { pid, host, token, startedAt, label: typeof label === 'string' ? label : '' }
  } catch {
    return null
  }
}

/**
 * Decide whether an existing lock may be taken over.
 *
 * A PID is only meaningful on the machine that minted it, so a record from
 * another host is judged by AGE alone. This is the one place a wrong answer is
 * expensive in both directions — stealing a live lock re-opens the race, never
 * stealing wedges every commit in the repo — so age is the backstop under both
 * branches.
 *
 * @param {LockRecord | null} record
 * @param {{ now: number, staleMs: number, isAlive: (pid: number) => boolean, host: string }} ctx
 * @returns {{ stale: true, reason: string } | { stale: false, holder: LockRecord }}
 */
export function lockIsStale(record, ctx) {
  if (record === null) return { stale: true, reason: 'unreadable lock file' }
  const age = ctx.now - record.startedAt
  if (age > ctx.staleMs) return { stale: true, reason: `held for ${Math.round(age / 1000)}s` }
  if (record.host === ctx.host && !ctx.isAlive(record.pid)) {
    return { stale: true, reason: `holder pid ${record.pid} is gone` }
  }
  return { stale: false, holder: record }
}

/**
 * Take the lock, waiting for a concurrent holder if there is one.
 *
 * @param {string} lockPath
 * @param {AcquireOptions} [options]
 * @returns {Promise<{ release: () => void, record: LockRecord }>}
 */
export async function acquireLock(lockPath, options = {}) {
  const {
    timeoutMs = 300_000,
    staleMs = 600_000,
    pollMs = 50,
    label = '',
    now = Date.now,
    isAlive = pidIsAlive,
    sleep = defaultSleep,
    onWait,
  } = options

  const host = hostname()
  const token = randomBytes(8).toString('hex')
  const deadline = now() + timeoutMs
  let announced = false

  mkdirSync(dirname(lockPath), { recursive: true })
  const staging = `${lockPath}.staging-${token}`

  for (;;) {
    /** @type {LockRecord} */
    const record = { pid: process.pid, host, token, startedAt: now(), label }
    try {
      writeFileSync(staging, JSON.stringify(record))
      linkSync(staging, lockPath)
      return { release: () => releaseLock(lockPath, token), record }
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err
    } finally {
      // The link made a second name for the same inode; the staging name is
      // never needed again, whether the link landed or not.
      rmSync(staging, { force: true })
    }

    const verdict = lockIsStale(readLock(lockPath), { now: now(), staleMs, isAlive, host })
    if (verdict.stale) {
      // Steal via an atomic rename so only one of several simultaneous stealers
      // wins. The loser's rename raises ENOENT and it simply retries.
      const claimed = `${lockPath}.stale-${token}`
      try {
        renameSync(lockPath, claimed)
        rmSync(claimed, { force: true })
      } catch {
        // Someone else got there first; fall through and retry.
      }
      continue
    }

    if (!announced) {
      announced = true
      const holder = verdict.holder
      onWait?.(
        `waiting for another worktree's ${holder.label || 'commit'} ` +
          `(pid ${holder.pid} on ${holder.host}) to release ${lockPath}`,
      )
    }

    if (now() >= deadline) {
      const holder = verdict.holder
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${lockPath}, ` +
          `held by pid ${holder.pid} on ${holder.host} since ` +
          `${new Date(holder.startedAt).toISOString()}. ` +
          `If that process is gone, delete the file and retry.`,
      )
    }

    await sleep(pollMs)
  }
}

/**
 * Drop a lock we hold. Deliberately a no-op unless the file still carries OUR
 * token: if a stale-detection sweep already took it away, the file on disk
 * belongs to someone else and removing it would hand them a broken mutex.
 * @param {string} lockPath
 * @param {string} token
 */
export function releaseLock(lockPath, token) {
  const record = readLock(lockPath)
  if (record !== null && record.token !== token) return
  rmSync(lockPath, { force: true })
}

/**
 * Resolve the lock path for a repository. Uses the COMMON git dir (`git
 * rev-parse --git-common-dir`), which every worktree shares — the same
 * property that makes `refs/stash` shared, and therefore the only scope at
 * which a lock excludes the right set of processes.
 * @param {string} commonGitDir
 * @param {string} name
 */
export function lockPathFor(commonGitDir, name) {
  return join(commonGitDir, name)
}

/**
 * Run `fn` while holding the lock, releasing it on every exit path.
 * @template T
 * @param {string} lockPath
 * @param {AcquireOptions} options
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLock(lockPath, options, fn) {
  const { release } = await acquireLock(lockPath, options)
  // A hook is routinely killed with ^C. Release on the way out or the next
  // commit in ANY worktree waits out the full stale window.
  const onSignal = () => {
    release()
    process.exit(1)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    return await fn()
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    release()
  }
}
