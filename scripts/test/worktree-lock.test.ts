import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { acquireLock, lockIsStale, releaseLock, withLock } from '../lib/worktree-lock.mjs'

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
})
