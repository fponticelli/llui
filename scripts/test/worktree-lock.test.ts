import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  acquireLock,
  lockIsStale,
  releaseLock,
  sameInode,
  withLock,
} from '../lib/worktree-lock.mjs'

/**
 * Cover for the cross-worktree commit lock (#179).
 *
 * The hazard it removes is invisible in a single process: `refs/stash` is one
 * ref on the COMMON git dir, so two worktrees running lint-staged at overlapping
 * times interleave their backups and the index lint-staged resolved for its own
 * entry now names someone else's by the time it drops or applies it.
 *
 * THE STRESS CONFIGURATION IS PART OF THE TEST, NOT AN ARBITRARY NUMBER, and it
 * is sized from a MEASURED per-round detection rate against the known-broken
 * first implementation of this lock:
 *
 *      6 workers x 40 ms hold ...  0 of 15 rounds detect  <- what shipped green
 *     16 workers x 25 ms hold ...  0 of 15 rounds detect
 *     32 workers x  1 ms hold ...  5 of 20 rounds detect
 *     40 workers x  0 ms hold ...  7 of 15 rounds detect
 *     48 workers x  0 ms hold ... 13 of 15 rounds detect  <- what runs below
 *
 * and against the FIXED implementation, 0 of 15 at every one of them. What finds
 * these races is MANY processes contending over a NEAR-EMPTY critical section,
 * not a long hold — a long hold merely makes the waiters queue politely, which
 * is why the original 6 x 40 ms configuration was green through two genuine
 * mutual-exclusion defects. Two rounds at 48 puts single-run detection near 98%
 * and costs ~2 s. Do not reduce these numbers; if this test becomes slow, make
 * the lock faster.
 */

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const lockModule = join(here, '..', 'lib', 'worktree-lock.mjs')
let dir = ''
let lockPath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-lock-'))
  lockPath = join(dir, 'test.lock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Write a lock record directly, bypassing acquisition. */
function plantLock(record: Record<string, unknown>): string {
  const raw = JSON.stringify(record)
  writeFileSync(lockPath, raw)
  return raw
}

describe('acquireLock', () => {
  it('creates the lock file and removes it on release', async () => {
    const { release, record } = await acquireLock(lockPath, { label: 'unit' })
    expect(existsSync(lockPath)).toBe(true)
    expect(record.pid).toBe(process.pid)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).label).toBe('unit')
    release()
    expect(existsSync(lockPath)).toBe(false)
  })

  it('waits for a live holder and proceeds once it releases', async () => {
    const first = await acquireLock(lockPath, { label: 'first' })

    let waited = ''
    let secondTaken = false
    const second = acquireLock(lockPath, {
      label: 'second',
      pollMs: 1,
      onWait: (message: string) => {
        waited = message
      },
    }).then((handle) => {
      secondTaken = true
      return handle
    })

    // Give the waiter several poll cycles to prove it does NOT get in.
    await new Promise((r) => setTimeout(r, 30))
    expect(secondTaken).toBe(false)
    expect(waited).toContain('first')

    first.release()
    const handle = await second
    expect(secondTaken).toBe(true)
    handle.release()
  })

  it('recovers from a holder that died without releasing', async () => {
    plantLock({
      pid: 424242,
      host: hostname(),
      token: 'dead',
      startedAt: Date.now(),
      label: 'crashed hook',
    })
    const { release, record } = await acquireLock(lockPath, {
      pollMs: 1,
      confirmMs: 5,
      isAlive: () => false,
    })
    expect(record.token).not.toBe('dead')
    release()
  })

  /**
   * RULE (2). A lock file that is simply GONE is the ordinary release path, not
   * an abandoned lock — and treating the two alike is what let a contender
   * delete a live holder's lock. There is nothing to steal here, so the acquire
   * must succeed by winning the create, never by breaking anything.
   */
  it('does not treat an absent lock as a stale one', async () => {
    let broke = false
    const { release } = await acquireLock(lockPath, {
      pollMs: 1,
      // If the implementation ever asks about liveness here it is judging a
      // record, which means it read one — impossible for an absent file.
      isAlive: () => {
        broke = true
        return false
      },
    })
    expect(broke).toBe(false)
    release()
  })

  /**
   * RULE (3). `readFileSync` is open-then-read, so a lock changing hands mid-read
   * yields the bytes of the unlinked OLD inode — a dead holder's record for a
   * lock that is live right now. One sighting must never be enough to remove it.
   */
  it('refuses to break a stale-looking record on a single sighting', async () => {
    plantLock({ pid: 424242, host: hostname(), token: 'ghost', startedAt: 1_000, label: 'ghost' })
    let clock = 1_000
    await expect(
      acquireLock(lockPath, {
        pollMs: 1,
        confirmMs: 10_000,
        timeoutMs: 500,
        isAlive: () => false,
        now: () => (clock += 100),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/Timed out/)
    // Still there: never broken, because it was never confirmed.
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).token).toBe('ghost')
  })

  it('breaks it once the SAME bytes have been confirmed for confirmMs', async () => {
    plantLock({ pid: 424242, host: hostname(), token: 'dead', startedAt: 1_000, label: 'dead' })
    let clock = 1_000
    const { release, record } = await acquireLock(lockPath, {
      pollMs: 1,
      confirmMs: 300,
      timeoutMs: 60_000,
      isAlive: () => false,
      now: () => (clock += 100),
      sleep: async () => undefined,
    })
    expect(record.token).not.toBe('dead')
    release()
  })

  it('times out with the holder identified rather than hanging forever', async () => {
    const held = await acquireLock(lockPath, { label: 'holder' })
    await expect(acquireLock(lockPath, { timeoutMs: 5, pollMs: 1 })).rejects.toThrow(
      /Timed out .* held by pid \d+/,
    )
    held.release()
  })

  it('reports a lock directory it cannot create, rather than a raw errno stack', async () => {
    // A path whose parent is a FILE can never be a directory.
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    await expect(acquireLock(join(blocker, 'nested', 'x.lock'), {})).rejects.toThrow(
      /cannot create the lock directory/,
    )
  })
})

/**
 * The predicate the FOURTH defect turned on, pinned deterministically.
 *
 * A break must replace the victim's INODE, so it has to ask "does `lockPath`
 * still name the thing I identified?". The first attempt asked `nlink >= 2`
 * instead — "does this inode still have at least two names?" — which is a
 * different question, and concurrent breakers make it the wrong one: each holds
 * its own probe link, so a victim's inode carries 1+N names and STILL has N >= 2
 * after the winner replaced it. Every loser then replaced it too (measured: one
 * victim broken 16 times). This is timing-free, unlike the stress tests, so the
 * regression cannot hide behind machine load.
 */
describe('sameInode', () => {
  it('is true for two names of one inode, false across a replacement', () => {
    const a = join(dir, 'a')
    const probe = join(dir, 'probe')
    writeFileSync(a, 'victim')
    linkSync(a, probe)
    expect(sameInode(a, probe)).toBe(true)

    // Replace `a` atomically, exactly as a break does.
    const replacement = join(dir, 'b')
    writeFileSync(replacement, 'mine')
    renameSync(replacement, a)
    expect(sameInode(a, probe)).toBe(false)
  })

  it('is NOT fooled where a link count is — the 16-double-break case', () => {
    const victim = join(dir, 'victim')
    writeFileSync(victim, 'v')
    // Three concurrent breakers, each holding its own probe link.
    const probes = ['p1', 'p2', 'p3'].map((n) => {
      const p = join(dir, n)
      linkSync(victim, p)
      return p
    })
    expect(statSync(probes[0]!).nlink).toBe(4) // victim + three probes

    // The winner replaces the victim.
    const winner = join(dir, 'winner')
    writeFileSync(winner, 'w')
    renameSync(winner, victim)

    // A link count still says "2 or more", so the old predicate let every loser
    // through; inode identity correctly says the victim is no longer there.
    expect(statSync(probes[0]!).nlink).toBeGreaterThanOrEqual(2)
    for (const p of probes) expect(sameInode(victim, p)).toBe(false)
  })

  it('is false when either name is gone', () => {
    const a = join(dir, 'gone-a')
    writeFileSync(a, 'x')
    expect(sameInode(a, join(dir, 'nope'))).toBe(false)
    expect(sameInode(join(dir, 'nope'), a)).toBe(false)
  })
})

describe('lockIsStale', () => {
  const host = 'this-host'
  const base = { pid: 10, host, token: 't', startedAt: 1_000, label: '' }

  it('treats a lock file that is not a lock record as stale', () => {
    const verdict = lockIsStale(null, { now: 1_000, staleMs: 100, isAlive: () => true, host })
    expect(verdict).toEqual({ stale: true, reason: 'lock file is not a lock record' })
  })

  it('treats a live same-host holder as held', () => {
    const verdict = lockIsStale(base, { now: 1_050, staleMs: 1_000, isAlive: () => true, host })
    expect(verdict.stale).toBe(false)
  })

  it('treats a dead same-host holder as stale', () => {
    const verdict = lockIsStale(base, { now: 1_050, staleMs: 1_000, isAlive: () => false, host })
    expect(verdict.stale).toBe(true)
  })

  /**
   * LIVENESS BEFORE AGE. The first version checked age first, so a genuinely
   * live `lint-staged` that outlived the window was stolen from — the very
   * failure this lock exists to prevent, reached from the other side. A hung
   * holder wedging the repo until a human intervenes is the safe direction, and
   * it is what git itself does with `index.lock`.
   */
  it('never ages out a LIVE same-host holder, however long it has held', () => {
    const ancient = { ...base, startedAt: 0 }
    const verdict = lockIsStale(ancient, {
      now: 99_999_999,
      staleMs: 1_000,
      isAlive: () => true,
      host,
    })
    expect(verdict.stale).toBe(false)
  })

  it('never reads a PID from another host, but still ages the lock out', () => {
    const foreign = { ...base, host: 'other-host' }
    // Same PID number, dead locally — must NOT be stolen on that basis.
    const young = lockIsStale(foreign, { now: 1_050, staleMs: 1_000, isAlive: () => false, host })
    expect(young.stale).toBe(false)
    // Age is the only backstop available for a foreign record.
    const old = lockIsStale(foreign, { now: 99_000, staleMs: 1_000, isAlive: () => false, host })
    expect(old.stale).toBe(true)
  })

  /**
   * The age backstop is only reachable if a waiter is still waiting when it
   * trips. `staleMs` above `timeoutMs` made it dead code: a foreign record
   * blocked every commit in every worktree for the full timeout and then threw.
   */
  it('ships a staleMs that a waiter can actually reach before its timeout', async () => {
    const source = readFileSync(join(here, '..', 'lib', 'worktree-lock.mjs'), 'utf8')
    const timeoutMs = Number(/timeoutMs = ([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ''))
    const staleMs = Number(/staleMs = ([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ''))
    expect(timeoutMs).toBeGreaterThan(0)
    expect(staleMs).toBeGreaterThan(0)
    expect(staleMs).toBeLessThan(timeoutMs)
  })
})

describe('releaseLock', () => {
  it('refuses to delete a lock that was stolen from us', async () => {
    const { release } = await acquireLock(lockPath, { label: 'ours' })
    const mine = JSON.parse(readFileSync(lockPath, 'utf8'))
    // Simulate a stale sweep having handed the lock to someone else.
    writeFileSync(lockPath, JSON.stringify({ ...mine, token: 'theirs' }))
    release()
    expect(existsSync(lockPath)).toBe(true)
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).token).toBe('theirs')
    releaseLock(lockPath, 'theirs')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('is a no-op on an already-absent lock', () => {
    expect(() => releaseLock(lockPath, 'whatever')).not.toThrow()
  })
})

describe('withLock', () => {
  it('releases the lock when the body throws', async () => {
    await expect(
      withLock(lockPath, { pollMs: 1 }, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(existsSync(lockPath)).toBe(false)
  })

  /**
   * THE LOAD-BEARING TEST, and the one that has now caught two real defects.
   *
   * Everything above runs in ONE process, where a broken exclusion primitive
   * hides behind the event loop; the race #179 describes is between separate OS
   * processes on a shared filesystem. This asserts mutual exclusion two
   * independent ways, because the weaker one alone was not enough:
   *
   *  - DISPLACEMENT: each worker records the lock's token on entry and re-reads
   *    it on exit. A holder whose token changed underneath it was displaced —
   *    this catches a steal even when the stealer politely declines to enter,
   *    which is exactly the case a journal-ordering check misses.
   *  - ORDERING: strict enter/exit alternation in an O_APPEND journal.
   */
  it('serializes real concurrent processes', async () => {
    const journal = join(dir, 'journal.ndjson')
    const worker = join(dir, 'worker.mjs')
    writeFileSync(
      worker,
      [
        `import { appendFileSync, readFileSync } from 'node:fs'`,
        `import { withLock } from ${JSON.stringify(lockModule)}`,
        `const [lockPath, journal, id] = process.argv.slice(2)`,
        `await withLock(lockPath, { pollMs: 1 }, async () => {`,
        `  const tok = JSON.parse(readFileSync(lockPath, 'utf8')).token`,
        `  appendFileSync(journal, JSON.stringify({ id, edge: 'enter', tok }) + '\\n')`,
        `  await new Promise((r) => setTimeout(r, 1))`,
        `  let now = 'GONE'`,
        `  try { now = JSON.parse(readFileSync(lockPath, 'utf8')).token } catch {}`,
        `  appendFileSync(journal, JSON.stringify({ id, edge: 'exit', tok, displaced: now !== tok }) + '\\n')`,
        `})`,
      ].join('\n'),
    )
    writeFileSync(journal, '')

    const WORKERS = 48
    const ROUNDS = 2
    for (let round = 0; round < ROUNDS; round++) {
      writeFileSync(journal, '')
      const codes = await Promise.all(
        Array.from(
          { length: WORKERS },
          (_unused, i) =>
            new Promise<number>((resolvePromise, rejectPromise) => {
              const child = spawn(process.execPath, [worker, lockPath, journal, `w${i}`], {
                stdio: ['ignore', 'ignore', 'inherit'],
              })
              child.on('error', rejectPromise)
              child.on('exit', (code) => resolvePromise(code ?? 1))
            }),
        ),
      )
      // A non-zero worker is itself a symptom: the broken implementation let the
      // lock file vanish underneath a holder, and the holder's read then threw.
      expect(codes.every((c) => c === 0)).toBe(true)

      const events = readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id: string; edge: string; displaced?: boolean })

      expect(events).toHaveLength(WORKERS * 2)
      expect(events.filter((e) => e.displaced)).toEqual([])
      for (let i = 0; i < events.length; i += 2) {
        expect(events[i]?.edge).toBe('enter')
        expect(events[i + 1]?.edge).toBe('exit')
        expect(events[i + 1]?.id).toBe(events[i]?.id)
      }
      expect(existsSync(lockPath)).toBe(false)
    }
  }, 120_000)

  /**
   * THE CRASH-RECOVERY WORKLOAD, and the one whose absence hid the fourth defect.
   *
   * The test above never leaves an abandoned lock, so it never exercises the
   * stale-break path at all — which is exactly where the removal half was still
   * unsound. Here a third of the contenders die WHILE HOLDING (`process.exit`,
   * no release), so every survivor must break a genuinely abandoned record while
   * dozens of others are trying to do the same. `confirmMs` makes them all fire
   * at the same instant, which is what supplies the racing breakers.
   *
   * Measured detection against the pre-fix implementation at this shape: 1-9
   * overlaps and 2-7 displaced holders per 10-12 rounds. After the fix, 0 across
   * every configuration tried (32-64 contenders, crash rates 1-in-2 to 1-in-4,
   * with and without extra CPU load), over 373 successful breaks with no victim
   * broken twice.
   */
  it('stays exclusive while crashed holders are being recovered', async () => {
    const journal = join(dir, 'crash-journal.ndjson')
    const worker = join(dir, 'crash-worker.mjs')
    writeFileSync(
      worker,
      [
        `import { appendFileSync, readFileSync } from 'node:fs'`,
        `import { acquireLock } from ${JSON.stringify(lockModule)}`,
        `const [lockPath, journal, id, crash] = process.argv.slice(2)`,
        `const h = await acquireLock(lockPath, { pollMs: 1, confirmMs: 60, timeoutMs: 60000 })`,
        `appendFileSync(journal, JSON.stringify({ id, edge: 'enter', tok: h.record.token }) + '\\n')`,
        // Die holding: no release, no cleanup. This is the abandoned lock.
        `if (crash === '1') process.exit(9)`,
        `await new Promise((r) => setTimeout(r, 1))`,
        `let now = 'GONE'`,
        `try { now = JSON.parse(readFileSync(lockPath, 'utf8')).token } catch {}`,
        `appendFileSync(journal, JSON.stringify({ id, edge: 'exit', tok: h.record.token, displaced: now !== h.record.token }) + '\\n')`,
        `h.release()`,
      ].join('\n'),
    )

    const WORKERS = 48
    const ROUNDS = 2
    for (let round = 0; round < ROUNDS; round++) {
      writeFileSync(journal, '')
      await Promise.all(
        Array.from(
          { length: WORKERS },
          (_unused, i) =>
            new Promise<void>((resolvePromise, rejectPromise) => {
              const child = spawn(
                process.execPath,
                [worker, lockPath, journal, `w${i}`, i % 3 === 0 ? '1' : '0'],
                { stdio: ['ignore', 'ignore', 'inherit'] },
              )
              child.on('error', rejectPromise)
              child.on('exit', () => resolvePromise())
            }),
        ),
      )
      // The last crasher may leave its lock behind; that is the point, not a leak.
      rmSync(lockPath, { force: true })

      const events = readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { id: string; edge: string; displaced?: boolean })

      // No survivor may have had its lock taken while it held it.
      expect(events.filter((e) => e.displaced)).toEqual([])

      // Among holders that COMPLETED (a crasher never writes `exit`), entry and
      // exit must strictly alternate — two live holders otherwise.
      const exited = new Set(events.filter((e) => e.edge === 'exit').map((e) => e.id))
      const completed = events.filter((e) => exited.has(e.id))
      expect(completed.length).toBeGreaterThan(0)
      for (let i = 0; i < completed.length; i += 2) {
        expect(completed[i]?.edge).toBe('enter')
        expect(completed[i + 1]?.edge).toBe('exit')
        expect(completed[i + 1]?.id).toBe(completed[i]?.id)
      }
    }
  }, 180_000)
})
