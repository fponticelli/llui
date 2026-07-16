import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  acquireClaimLock,
  appendStatus,
  currentStatus,
  listQueue,
  readAllTransitions,
  readStatusHistory,
} from '../src/notes/status.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-status-'))
  mkdirSync(join(dir, 'session-test'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const session = (): string => join(dir, 'session-test')

describe('status sidecar', () => {
  it('appendStatus writes lines to status.jsonl', () => {
    appendStatus(session(), {
      ts: '2026-05-23T00:00:00Z',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2026-05-23T00:00:01Z',
      noteId: '001',
      from: 'open',
      to: 'claimed',
      by: 'llm',
    })
    const all = readAllTransitions(session())
    expect(all).toHaveLength(2)
    expect(all[0]!.to).toBe('open')
    expect(all[1]!.to).toBe('claimed')
  })

  it('readStatusHistory filters to a single note', () => {
    appendStatus(session(), {
      ts: '2026-05-23T00:00:00Z',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2026-05-23T00:00:01Z',
      noteId: '002',
      from: null,
      to: 'open',
      by: 'human',
    })
    expect(readStatusHistory(session(), '001')).toHaveLength(1)
    expect(readStatusHistory(session(), '002')).toHaveLength(1)
    expect(readStatusHistory(session(), '999')).toEqual([])
  })

  it('currentStatus returns the last `to` value', () => {
    appendStatus(session(), {
      ts: '2026-05-23T00:00:00Z',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2026-05-23T00:00:01Z',
      noteId: '001',
      from: 'open',
      to: 'proposed',
      by: 'llm',
    })
    expect(currentStatus(session(), '001')).toBe('proposed')
  })

  it('currentStatus returns null when no history', () => {
    expect(currentStatus(session(), '001')).toBe(null)
  })

  it('listQueue groups by noteId and returns latest status', () => {
    appendStatus(session(), {
      ts: '2026-05-23T00:00:00Z',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2026-05-23T00:00:01Z',
      noteId: '002',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2026-05-23T00:00:02Z',
      noteId: '001',
      from: 'open',
      to: 'claimed',
      by: 'llm',
    })
    const queue = listQueue(session())
    expect(queue).toHaveLength(2)
    const byId = new Map(queue.map((q) => [q.noteId, q]))
    expect(byId.get('001')!.status).toBe('claimed')
    expect(byId.get('002')!.status).toBe('open')
  })

  it('listQueue filters by status', () => {
    appendStatus(session(), {
      ts: '1',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '2',
      noteId: '002',
      from: null,
      to: 'open',
      by: 'human',
    })
    appendStatus(session(), {
      ts: '3',
      noteId: '001',
      from: 'open',
      to: 'rejected',
      by: 'human',
    })
    expect(listQueue(session(), { status: 'open' })).toHaveLength(1)
    expect(listQueue(session(), { status: ['open', 'rejected'] })).toHaveLength(2)
  })

  it('skips malformed lines silently', () => {
    appendStatus(session(), {
      ts: '1',
      noteId: '001',
      from: null,
      to: 'open',
      by: 'human',
    })
    // Inject a garbage line
    const path = join(session(), 'status.jsonl')
    const { appendFileSync } = require('node:fs') as typeof import('node:fs')
    appendFileSync(path, 'not json at all\n', 'utf8')
    appendStatus(session(), {
      ts: '2',
      noteId: '001',
      from: 'open',
      to: 'claimed',
      by: 'llm',
    })
    const all = readAllTransitions(session())
    expect(all).toHaveLength(2)
  })
})

describe('acquireClaimLock (N21 atomic claim arbiter)', () => {
  it('grants the lock to the first caller and reports EEXIST to the rest', () => {
    const first = acquireClaimLock(session(), '001', 'worker-1')
    expect(first).toEqual({ acquired: true, holder: 'worker-1' })

    // A second claim (as another process would) loses the exclusive create
    // and reads the winner's workerId back out of the lock file.
    const second = acquireClaimLock(session(), '001', 'worker-2')
    expect(second.acquired).toBe(false)
    expect(second.holder).toBe('worker-1')
  })

  it('locks are per-note, not global', () => {
    expect(acquireClaimLock(session(), '001', 'w1').acquired).toBe(true)
    expect(acquireClaimLock(session(), '002', 'w2').acquired).toBe(true)
  })

  it('rejects a noteId that would escape the session dir', () => {
    expect(() => acquireClaimLock(session(), '../evil', 'w')).toThrow(/invalid noteId/)
    expect(() => acquireClaimLock(session(), 'a/b', 'w')).toThrow(/invalid noteId/)
  })
})
