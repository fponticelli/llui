import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  linkSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { hostname } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'

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
 * ── The four rules that make this a mutex, each written in blood ────────────
 *
 * Read the sequence before changing anything here: FOUR mutual-exclusion defects
 * shipped in this file, each one reachable only after the previous was fixed,
 * and each one found by contending harder rather than by reasoning. Rules (1)
 * and (2) are about the JUDGING half, (3) and (4) about the REMOVAL half, and
 * the recurring mistake every time was believing the judging half was the whole
 * problem.
 *
 * (1) ACQUISITION IS `link(2)`, NOT `openSync(path, 'wx')`. Both are atomic
 *     creates, but `wx` leaves the lock file EMPTY between the create and the
 *     write of its record, and a contender reading it in that window sees
 *     unparseable content and concludes the lock is abandoned. The first draft
 *     used `wx` and the stress test below caught two workers inside the critical
 *     section at once. `link(2)` publishes the record and the lock in one
 *     atomic step: the record is written to a private staging file FIRST and
 *     only then linked into place, so a lock is never visible without its
 *     contents, and `link` still fails EEXIST when the target exists.
 *
 * (2) A MISSING LOCK IS NOT A STALE LOCK. This is the defect review caught, and
 *     it is the SAME class as #179 itself — a read, then an unconditional
 *     mutation of whatever is at the path by the time the mutation runs. The
 *     first draft's `readLock` collapsed "file does not exist" into the same
 *     `null` as "file is garbage", called both `{stale: true}`, and then
 *     `renameSync`d the path. But a missing lock is the ORDINARY case: every
 *     normal `releaseLock` removes the file, so any contender sitting between
 *     its failed `linkSync` and its read sees the gap, declares the (already
 *     gone) lock stale, and renames away the lock a DIFFERENT process has since
 *     legitimately acquired. Measured on the unmodified algorithm at 32
 *     concurrent processes: every steal reported `"unreadable lock file"`, never
 *     a dead holder and never an age-out, with up to 560 ms of two processes in
 *     the critical section. An absent lock needs no stealing at all — the next
 *     `linkSync` simply wins or loses fairly — so ENOENT now means RETRY.
 *
 * (3) A STALE VERDICT IS CONFIRMED ACROSS TWO READS BEFORE ANYTHING IS REMOVED.
 *     `readFileSync` is open-then-read, so when the lock changes hands between
 *     those two syscalls the read returns the bytes of the UNLINKED OLD INODE —
 *     a record whose process has since exited. Judging that snapshot gives
 *     `holder pid N is gone` about a lock that is at this instant held, live, by
 *     somebody else. Measured: with 48 contending processes EVERY observed steal
 *     had that reason, and the victim pid really was dead — because it was a
 *     ghost read of a released holder, not the current one.
 *
 *     Verifying AFTER the rename is not enough on its own, and the first fix
 *     attempt proved it: `breakLock` correctly refused to enter (the bytes it
 *     removed did not match the bytes it judged) but the innocent holder's lock
 *     had already been unlinked for the duration, and a third process linking
 *     into that gap co-held the section with it — 21 overlaps in 10 rounds.
 *     REFUSING TO ENTER IS NOT THE SAME AS NOT HAVING REMOVED IT.
 *
 *     So a stale verdict is gated on the same bytes being observed TWICE,
 *     `confirmMs` apart. A ghost read cannot survive that — the next read opens
 *     the live inode — while a genuinely abandoned record is byte-identical for
 *     as long as it sits there.
 *
 * (4) A BREAK NEVER EMPTIES THE PATH: IDENTIFY WITHOUT REMOVING, ELECT ONE
 *     BREAKER, THEN REPLACE ATOMICALLY. Rule (3) fixed the judging half and left
 *     the removal half exactly as unsound — `breakLock` still unlinked FIRST and
 *     only then asked whose lock it had taken, so the answer arrived after the
 *     damage. A third contender linking into that gap co-held the section with
 *     the innocent holder it had displaced. Measured on the rule-(3) code: 2-9
 *     overlaps per 10 rounds at 48 processes with crashed holders.
 *
 *     And `confirmMs` SUPPLIES the racing breakers rather than reducing them:
 *     every waiter watching the same stale record fires at the same instant.
 *
 *     So, in order: hard-link the lock to a PRIVATE name (identity with no
 *     window, and no open-then-read hazard, because nobody else can touch it);
 *     win an exclusive-create election keyed by the victim's bytes, so exactly
 *     one process may act on a given record; re-check that `lockPath` still
 *     names the victim's INODE; then `rename` our record over it in one step.
 *     `lockPath` is never absent, so no waiter can link into a gap, and the
 *     breaker HOLDS the lock on success — there is no re-acquire for anyone
 *     else to win instead.
 *
 *     The inode check is an INODE-NUMBER comparison, never a link count. The
 *     first attempt at this rule used `nlink >= 2` and failed for a reason worth
 *     keeping: with N concurrent breakers each holding a probe link the victim's
 *     inode has 1+N names, so after the winner's rename it still has N >= 2 and
 *     every loser's check passed — one victim was broken 16 times. `nlink`
 *     answers "how many names exist", which is not the question.
 *
 *     Residual, stated rather than claimed closed: a FOREIGN-HOST record aged
 *     out by rule `staleMs` may belong to a process that is still alive, and no
 *     PID is readable across machines to tell. That case can still be replaced
 *     under its owner. It is inherent to a filesystem lock shared across hosts,
 *     it is not the crash-recovery case above, and this repo's worktrees are all
 *     on one machine.
 */

/** @typedef {{ pid: number, host: string, token: string, startedAt: number, label: string }} LockRecord */

/**
 * @typedef {object} AcquireOptions
 * @property {number} [timeoutMs]  Give up waiting after this long. Default 300_000.
 * @property {number} [staleMs]    Age at which a FOREIGN-HOST lock is presumed
 *   abandoned. Must stay BELOW `timeoutMs` or the backstop is unreachable.
 *   Default 120_000.
 * @property {number} [pollMs]     Delay between attempts. Default 50.
 * @property {number} [confirmMs]  How long an abandoned record must be observed
 *   BYTE-IDENTICAL before it may be removed. Guards against a ghost read of an
 *   unlinked inode; see rule (3). Default 250.
 * @property {number} [breakerTtlMs] How long a breaker-election token may sit
 *   before it is treated as abandoned. Only ever costs a retry. Default 5_000.
 * @property {string} [label]      Free text recorded in the lock, shown when waiting.
 * @property {() => number} [now]  Clock, injectable for tests.
 * @property {(pid: number) => boolean} [isAlive] Liveness probe, injectable for tests.
 * @property {(ms: number) => Promise<void>} [sleep] Delay, injectable for tests.
 * @property {(message: string) => void} [onWait] Called once when the first wait starts.
 */

/**
 * Default liveness probe: signal 0 tests for existence without delivering anything.
 * @param {number} pid
 * @returns {boolean}
 */
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

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @typedef {{ kind: 'absent' } | { kind: 'present', raw: string, record: LockRecord | null }} LockSnapshot
 */

/**
 * The slice of `AcquireOptions` the break path needs: a clock, a liveness probe
 * and the breaker-token TTL. Named rather than inlined because `breakAndTake`
 * and `reapAbandonedBreaker` must agree on it exactly — the second is handed the
 * first's `ctx` verbatim.
 *
 * @typedef {object} BreakContext
 * @property {() => number} now
 * @property {(pid: number) => boolean} isAlive
 * @property {number} breakerTtlMs
 */

/**
 * Snapshot the lock file.
 *
 * ABSENT and PRESENT-BUT-GARBAGE are returned as DIFFERENT things, and keeping
 * them apart is rule (2) above — collapsing them is what let a contender steal a
 * live holder's lock on the ordinary release path. `raw` is carried through so a
 * later steal can prove it removed the very bytes it judged.
 *
 * @param {string} lockPath
 * @returns {LockSnapshot}
 */
function snapshotLock(lockPath) {
  let raw
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { kind: 'absent' }
    throw err
  }
  return { kind: 'present', raw, record: parseRecord(raw) }
}

/**
 * Parse a lock record, or null when the bytes are not one we wrote. Null means
 * GARBAGE, never "missing" — every lock this module publishes is fully written
 * before it becomes visible, so unparseable content cannot be a live holder
 * mid-write.
 * @param {string} raw
 * @returns {LockRecord | null}
 */
function parseRecord(raw) {
  try {
    const parsed = JSON.parse(raw)
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
 * ORDER MATTERS, and the first version had it wrong in both directions.
 * LIVENESS decides first for a same-host record: a holder whose process is still
 * running is NEVER stale, however long it has held. Checking age first meant a
 * genuinely live `lint-staged` past the age window was stolen from — which is
 * the failure this lock exists to prevent, arrived at from the other side. The
 * cost is that a HUNG holder wedges the repo until its process dies or a human
 * removes the file; that is git's own behaviour for `index.lock`, it is the safe
 * direction, and `acquireLock` names the file and the holder when it times out.
 *
 * AGE is the backstop only where liveness cannot be read: a PID is meaningless
 * on a machine that did not mint it, so a foreign-host record is judged by age
 * alone. `staleMs` must therefore stay below `timeoutMs`, or the backstop is
 * unreachable and a foreign record blocks every commit in every worktree for the
 * full timeout before failing.
 *
 * @param {LockRecord | null} record  null = present but unparseable (garbage).
 * @param {{ now: number, staleMs: number, isAlive: (pid: number) => boolean, host: string }} ctx
 * @returns {{ stale: true, reason: string } | { stale: false, holder: LockRecord }}
 */
export function lockIsStale(record, ctx) {
  // Garbage: nothing this module wrote, so nobody is holding it. Removal is
  // still VERIFIED by `breakLock`, so a concurrent legitimate acquire is safe.
  if (record === null) return { stale: true, reason: 'lock file is not a lock record' }

  if (record.host === ctx.host) {
    if (ctx.isAlive(record.pid)) return { stale: false, holder: record }
    return { stale: true, reason: `holder pid ${record.pid} is gone` }
  }

  const age = ctx.now - record.startedAt
  if (age > ctx.staleMs) {
    return { stale: true, reason: `foreign-host lock held for ${Math.round(age / 1000)}s` }
  }
  return { stale: false, holder: record }
}

/**
 * Remove a lock we have judged removable, and PROVE we removed the right one.
 *
 * `renameSync` is the removal because it is atomic AND it hands back the bytes:
 * the file is now at a private path only we know, so reading it tells us exactly
 * whose lock we took. If those bytes are not the ones we judged, the lock
 * changed under us — someone released and someone else legitimately acquired
 * between our read and our rename — so we link the innocent holder's record
 * straight back and report failure, and the caller does NOT enter.
 *
 * @param {string} lockPath
 * @param {string} expectedRaw  The exact bytes the caller judged.
 * @param {string} myRaw        Our own record, swapped in over the victim's.
 * @param {string} token        Ours, only to name the private path uniquely.
 * @param {BreakContext} ctx
 * @returns {boolean} true when the intended victim was removed.
 */
function breakAndTake(lockPath, expectedRaw, myRaw, token, ctx) {
  const probe = `${lockPath}.probe-${token}`
  const mine = `${lockPath}.take-${token}`
  const brkStaging = `${lockPath}.brk-${token}`
  // Keyed by the VICTIM, so two breakers of the same record contend and exactly
  // one wins, while breakers of different records never block each other. The
  // victim's `token` is 8 random bytes minted per acquisition, so a key is
  // never reused and a stranded token can never block a future, different
  // victim.
  const breaker = `${lockPath}.break-${createHash('sha256').update(expectedRaw).digest('hex').slice(0, 16)}`
  let elected = false

  try {
    // 1. IDENTITY WITHOUT REMOVAL. A hard link gives a second name for the same
    //    inode while leaving `lockPath` in place, so reading the PRIVATE name
    //    tells us exactly whose lock is there — with no window in which the
    //    path is empty, and no open-then-read hazard, because nobody else can
    //    touch `probe`.
    try {
      linkSync(lockPath, probe)
    } catch {
      return false // gone already; nothing to break
    }
    if (readFileSync(probe, 'utf8') !== expectedRaw) return false // not our victim

    // 2. ELECT ONE BREAKER. Concurrent waiters all confirm the same stale bytes
    //    at the same instant (`confirmMs` makes them synchronise), so without
    //    this they would all act. Exclusive create picks exactly one.
    writeFileSync(brkStaging, JSON.stringify({ pid: process.pid, at: ctx.now() }))
    try {
      linkSync(brkStaging, breaker)
      elected = true
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err
      if (!reapAbandonedBreaker(breaker, ctx)) return false // another breaker is on it
      try {
        linkSync(brkStaging, breaker)
        elected = true
      } catch {
        return false
      }
    }

    // 3. `lockPath` must STILL name the victim's INODE — compared by inode
    //    number, never by link count. A link count is not an identity test and
    //    reading it as one is how the previous attempt failed: with N breakers
    //    each holding their own probe link, the victim's inode carries 1+N
    //    names, so after the winner's rename it still has N >= 2 and EVERY
    //    loser's `nlink >= 2` check passed. Measured: one victim broken 16
    //    times. The count answers "how many names exist", which is not the
    //    question.
    if (!sameInode(lockPath, probe)) return false

    // 4. ATOMIC REPLACE, not remove-then-reacquire. `rename` swaps our record in
    //    over the victim's in one step, so `lockPath` is NEVER absent and no
    //    waiter can link into a gap. This is the half `confirmMs` did not fix:
    //    the previous version unlinked first and only then asked whose lock it
    //    was, and a third contender linking into that window co-held the
    //    section with the innocent holder it had displaced.
    writeFileSync(mine, myRaw)
    renameSync(mine, lockPath)
    return true
  } finally {
    rmSync(probe, { force: true })
    rmSync(mine, { force: true })
    rmSync(brkStaging, { force: true })
    if (elected) rmSync(breaker, { force: true })
  }
}

/**
 * Do `a` and `b` name the same inode right now?
 *
 * This is the identity test a lock needs, and it is deliberately NOT a link
 * count: `nlink` says how many names an inode has, which several concurrent
 * probes make meaningless. Device is compared as well as inode number, since
 * inode numbers are only unique within a filesystem.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameInode(a, b) {
  try {
    const sa = statSync(a)
    const sb = statSync(b)
    return sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false // one of them is gone
  }
}

/**
 * Remove a breaker token nobody is using any more.
 *
 * Deliberately liberal: losing this election only costs a retry, and removing a
 * token that IS in use merely restores the pre-election behaviour of two
 * breakers — which step 4 above already makes safe. Being conservative here, by
 * contrast, would let one crashed breaker wedge every future break of that
 * victim.
 * @param {string} breaker
 * @param {BreakContext} ctx
 * @returns {boolean} true when the caller may retry the election.
 */
function reapAbandonedBreaker(breaker, ctx) {
  try {
    const held = /** @type {Record<string, unknown>} */ (JSON.parse(readFileSync(breaker, 'utf8')))
    const at = held['at']
    const pid = held['pid']
    const age = ctx.now() - (typeof at === 'number' ? at : 0)
    const ownerGone = typeof pid === 'number' && !ctx.isAlive(pid)
    if (!ownerGone && age < ctx.breakerTtlMs) return false
  } catch {
    // Unreadable: treat as abandoned.
  }
  rmSync(breaker, { force: true })
  return true
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
    staleMs = 120_000,
    pollMs = 50,
    confirmMs = 250,
    breakerTtlMs = 5_000,
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
  /** The candidate for a stale-break, and when we first saw these exact bytes.
   *  @type {{ raw: string, firstSeenAt: number } | null} */
  let pending = null

  try {
    mkdirSync(dirname(lockPath), { recursive: true })
  } catch (err) {
    throw new Error(
      `cannot create the lock directory ${dirname(lockPath)}: ` +
        `${/** @type {Error} */ (err).message}`,
      { cause: err },
    )
  }
  const staging = `${lockPath}.staging-${token}`

  for (;;) {
    /** @type {LockRecord} */
    const record = { pid: process.pid, host, token, startedAt: now(), label }
    try {
      writeFileSync(staging, JSON.stringify(record))
      linkSync(staging, lockPath)
      return { release: () => releaseLock(lockPath, token), record }
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code
      if (code !== 'EEXIST') {
        throw new Error(
          `cannot write the lock file ${lockPath}: ` + `${/** @type {Error} */ (err).message}`,
          {
            cause: err,
          },
        )
      }
    } finally {
      // The link made a second name for the same inode; the staging name is
      // never needed again, whether the link landed or not.
      rmSync(staging, { force: true })
    }

    const snapshot = snapshotLock(lockPath)

    // RULE (2): the holder released between our link attempt and this read.
    // There is nothing to steal — go straight back round and race for it fairly.
    if (snapshot.kind === 'absent') {
      pending = null
      if (now() >= deadline) throw timedOut(lockPath, timeoutMs, null)
      // Yield rather than spin: an alternation of failed-link and absent-read
      // under heavy contention would otherwise burn a core until the deadline.
      // A zero delay keeps the re-acquire latency at "next tick", which is the
      // point of not sleeping a full poll interval here.
      await sleep(0)
      continue
    }

    const verdict = lockIsStale(snapshot.record, { now: now(), staleMs, isAlive, host })
    if (verdict.stale) {
      // RULE (3): confirm before removing. A ghost read of an unlinked inode
      // yields a dead-looking record for a lock that is live RIGHT NOW; it
      // cannot repeat, because the next read opens the current inode.
      if (pending === null || pending.raw !== snapshot.raw) {
        pending = { raw: snapshot.raw, firstSeenAt: now() }
      } else if (now() - pending.firstSeenAt >= confirmMs) {
        // RULE (4): break by REPLACING, never by removing — and we hold it on
        // success, so there is no re-acquire step for anyone to win instead.
        const took = breakAndTake(lockPath, snapshot.raw, JSON.stringify(record), token, {
          now,
          isAlive,
          breakerTtlMs,
        })
        pending = null
        if (took) return { release: () => releaseLock(lockPath, token), record }
        continue
      }
      if (now() >= deadline) throw timedOut(lockPath, timeoutMs, null)
      await sleep(pollMs)
      continue
    }
    // A live holder: any pending steal was about a record that is no longer there.
    pending = null

    if (!announced) {
      announced = true
      const holder = verdict.holder
      onWait?.(
        `waiting for another worktree's ${holder.label || 'commit'} ` +
          `(pid ${holder.pid} on ${holder.host}) to release ${lockPath}`,
      )
    }

    if (now() >= deadline) throw timedOut(lockPath, timeoutMs, verdict.holder)

    await sleep(pollMs)
  }
}

/**
 * @param {string} lockPath
 * @param {number} timeoutMs
 * @param {LockRecord | null} holder
 */
function timedOut(lockPath, timeoutMs, holder) {
  const who = holder
    ? `held by pid ${holder.pid} on ${holder.host} since ${new Date(holder.startedAt).toISOString()}`
    : 'the lock kept changing hands'
  return new Error(
    `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${lockPath}, ${who}. ` +
      `If no such process is running, delete the file and retry.`,
  )
}

/**
 * Drop a lock we hold.
 *
 * Identity is established the same way a break establishes it — a private hard
 * link, so the bytes read are provably the bytes at `lockPath` and no
 * open-then-read ghost is possible — and the unlink is gated on the link count
 * still showing two names. A plain `read, then rm` would remove whatever is at
 * the path at `rm` time, which is exactly the two-step this file exists to
 * avoid.
 * @param {string} lockPath
 * @param {string} token
 */
export function releaseLock(lockPath, token) {
  const probe = `${lockPath}.rel-${token}`
  try {
    linkSync(lockPath, probe)
  } catch {
    return // already gone
  }
  try {
    const record = parseRecord(readFileSync(probe, 'utf8'))
    if (record === null || record.token !== token) return // not ours any more
    if (!sameInode(lockPath, probe)) return // somebody already replaced it
    unlinkSync(lockPath)
  } catch {
    // Nothing left to release.
  } finally {
    rmSync(probe, { force: true })
  }
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
