import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
 * These tests therefore check the two things that actually make the lock a
 * mutex — mutual exclusion between REAL concurrent OS processes, and that a
 * dead holder can never wedge the repo — rather than only the happy path.
 */

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
let dir = ''
let lockPath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-lock-'))
  lockPath = join(dir, 'test.lock')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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
      onWait: (message) => {
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

  it('steals a lock whose holder process is gone', async () => {
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 424242,
        host: (await import('node:os')).hostname(),
        token: 'dead',
        startedAt: Date.now(),
        label: 'crashed hook',
      }),
    )
    // A dead holder must not be waited on at all — no timeout is required.
    const { release, record } = await acquireLock(lockPath, {
      pollMs: 1,
      isAlive: () => false,
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
})

describe('lockIsStale', () => {
  const host = 'this-host'
  const base = { pid: 10, host, token: 't', startedAt: 1_000, label: '' }

  it('treats an unreadable lock as stale', () => {
    expect(lockIsStale(null, { now: 1_000, staleMs: 100, isAlive: () => true, host })).toEqual({
      stale: true,
      reason: 'unreadable lock file',
    })
  })

  it('treats a live same-host holder as held', () => {
    const verdict = lockIsStale(base, { now: 1_050, staleMs: 1_000, isAlive: () => true, host })
    expect(verdict.stale).toBe(false)
  })

  it('treats a dead same-host holder as stale', () => {
    const verdict = lockIsStale(base, { now: 1_050, staleMs: 1_000, isAlive: () => false, host })
    expect(verdict.stale).toBe(true)
  })

  it('never reads a PID from another host, but still ages the lock out', () => {
    const foreign = { ...base, host: 'other-host' }
    // Same PID number, dead locally — must NOT be stolen on that basis.
    const young = lockIsStale(foreign, { now: 1_050, staleMs: 1_000, isAlive: () => false, host })
    expect(young.stale).toBe(false)
    // Age is the backstop that keeps a foreign lock from wedging the repo.
    const old = lockIsStale(foreign, { now: 99_000, staleMs: 1_000, isAlive: () => false, host })
    expect(old.stale).toBe(true)
  })
})

describe('releaseLock', () => {
  it('refuses to delete a lock that was stolen from us', async () => {
    const { release } = await acquireLock(lockPath, { label: 'ours' })
    // Simulate a stale sweep handing the lock to someone else.
    releaseLock(lockPath, 'someone-elses-token-does-not-match')
    expect(existsSync(lockPath)).toBe(true)
    const stolen = JSON.parse(readFileSync(lockPath, 'utf8'))
    writeFileSync(lockPath, JSON.stringify({ ...stolen, token: 'theirs' }))
    release()
    expect(existsSync(lockPath)).toBe(true)
    releaseLock(lockPath, 'theirs')
    expect(existsSync(lockPath)).toBe(false)
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
   * The load-bearing test. Everything above runs in ONE process, where a bug in
   * the exclusion primitive can hide behind the event loop; the race #179
   * describes is between separate OS processes on a shared filesystem. Six real
   * `node` processes contend for one lock, each appending its enter/exit
   * timestamps; if any two critical sections overlap, the lock is not a lock.
   */
  it('serializes real concurrent processes', async () => {
    const journal = join(dir, 'journal.ndjson')
    const worker = join(dir, 'worker.mjs')
    writeFileSync(
      worker,
      [
        `import { appendFileSync } from 'node:fs'`,
        `import { withLock } from ${JSON.stringify(join(here, '..', 'lib', 'worktree-lock.mjs'))}`,
        `const [lockPath, journal, id] = process.argv.slice(2)`,
        `await withLock(lockPath, { pollMs: 2 }, async () => {`,
        `  appendFileSync(journal, JSON.stringify({ id, at: Date.now(), edge: 'enter' }) + '\\n')`,
        `  await new Promise((r) => setTimeout(r, 40))`,
        `  appendFileSync(journal, JSON.stringify({ id, at: Date.now(), edge: 'exit' }) + '\\n')`,
        `})`,
      ].join('\n'),
    )
    writeFileSync(journal, '')

    const workers = Array.from(
      { length: 6 },
      (_unused, i) =>
        new Promise<number>((resolvePromise, rejectPromise) => {
          const child = spawn(process.execPath, [worker, lockPath, journal, `w${i}`], {
            stdio: ['ignore', 'inherit', 'inherit'],
          })
          child.on('error', rejectPromise)
          child.on('exit', (code) => resolvePromise(code ?? 1))
        }),
    )
    expect(await Promise.all(workers)).toEqual([0, 0, 0, 0, 0, 0])

    const events = journal
      ? readFileSync(journal, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { id: string; edge: string })
      : []
    expect(events).toHaveLength(12)
    // Strict alternation enter/exit for the SAME id is exactly "no two critical
    // sections overlapped".
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]?.edge).toBe('enter')
      expect(events[i + 1]?.edge).toBe('exit')
      expect(events[i + 1]?.id).toBe(events[i]?.id)
    }
    expect(existsSync(lockPath)).toBe(false)
  }, 30_000)
})
