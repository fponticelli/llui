import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEventBus } from '../src/notes/event-bus.js'
import { createNote } from '../src/notes/store.js'
import { appendStatus, currentStatus, readStatusHistory } from '../src/notes/status.js'
import { startRouter, type ClaudeSpawner } from '../src/notes/router.js'
import type { NoteFrontmatter } from '../src/notes/types.js'

const fmTask: Omit<NoteFrontmatter, 'id' | 'ts'> = {
  author: 'human',
  kind: 'text',
  captureLevel: 'standard',
  url: 'http://localhost:5173/',
  route: null,
  routeParams: {},
  viewport: { w: 1440, h: 900, dpr: 2 },
  componentPath: null,
  componentMeta: null,
  annotations: [],
  screenshot: null,
  agentSchemas: [],
  llui: { runtime: '0.4.3', compiler: '0.5.6' },
  intent: 'task',
}

const fmNote: Omit<NoteFrontmatter, 'id' | 'ts'> = { ...fmTask, intent: 'note' }

function mockSpawner(
  behavior: (opts: { prompt: string }) => Promise<{
    exitCode: number
    stdout?: string
    stderr?: string
    timedOut?: boolean
    /** Optional side-effect to mutate status mid-spawn, simulating
     *  the LLM calling llui_reply_to_note. */
    sideEffect?: () => void
  }>,
): ClaudeSpawner & { calls: Array<{ prompt: string; cwd: string }> } {
  const calls: Array<{ prompt: string; cwd: string }> = []
  return {
    calls,
    async spawn({ prompt, cwd }) {
      calls.push({ prompt, cwd })
      const result = await behavior({ prompt })
      if (result.sideEffect) result.sideEffect()
      return {
        exitCode: result.exitCode,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        timedOut: result.timedOut ?? false,
      }
    },
  }
}

let notesRoot: string

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-router-'))
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

describe('startRouter', () => {
  it('claims a task note when note-created fires', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({ exitCode: 0 }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    // Drain the microtask queue + give the async pipeline a chance.
    await new Promise((r) => setTimeout(r, 10))

    expect(spawner.calls).toHaveLength(1)
    const sessionDir = join(notesRoot, note.sessionId)
    const history = readStatusHistory(sessionDir, note.id)
    // Router only writes 'claimed' (and possibly 'failed' if no reply).
    expect(history.some((t) => t.to === 'claimed')).toBe(true)
    handle.stop()
  })

  it('ignores intent=note (FYI) notes', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({ exitCode: 0 }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fyi', frontmatter: fmNote, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(spawner.calls).toHaveLength(0)
    handle.stop()
  })

  it('marks task as "failed" when claude exits non-zero', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({
      exitCode: 1,
      stderr: 'auth failed',
    }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))

    const sessionDir = join(notesRoot, note.sessionId)
    expect(currentStatus(sessionDir, note.id)).toBe('failed')
    handle.stop()
  })

  it('marks task as "failed" when claude times out', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({ exitCode: -1, timedOut: true }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })
    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))
    const sessionDir = join(notesRoot, note.sessionId)
    const last = readStatusHistory(sessionDir, note.id).at(-1)
    expect(last?.to).toBe('failed')
    expect(last?.reason).toMatch(/timed out/)
    handle.stop()
  })

  it('respects the LLM updating status to "proposed" mid-spawn (no failed transition appended)', async () => {
    const bus = createEventBus()
    // Simulate the LLM calling llui_reply_to_note during the spawn,
    // which bumps the task to 'proposed' before claude exits.
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner: mockSpawner(async () => ({ exitCode: 0 })),
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })

    // Pre-emptively flip the status to proposed AFTER the router
    // claims but BEFORE its post-spawn check. We do this by hooking
    // into a custom spawner that mutates state itself.
    handle.stop() // stop the simple router
    const sneakySpawner = mockSpawner(async () => ({
      exitCode: 0,
      sideEffect: () => {
        const sessionDir = join(notesRoot, note.sessionId)
        appendStatus(sessionDir, {
          ts: new Date().toISOString(),
          noteId: note.id,
          from: 'claimed',
          to: 'proposed',
          by: 'llm',
          reason: 'reply 002: simulated',
        })
      },
    }))
    const h2 = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner: sneakySpawner,
      log: () => {},
    })

    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))

    const sessionDir = join(notesRoot, note.sessionId)
    // Status should be 'proposed', NOT 'failed'.
    expect(currentStatus(sessionDir, note.id)).toBe('proposed')
    h2.stop()
  })

  it('processes tasks serially (one at a time)', async () => {
    const bus = createEventBus()
    let inFlight = 0
    let maxInFlight = 0
    const spawner = mockSpawner(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { exitCode: 0 }
    })
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })

    for (let i = 0; i < 3; i++) {
      const note = createNote(notesRoot, {
        body: `task ${i}`,
        frontmatter: fmTask,
        noteBody: {},
      })
      bus.broadcast({
        type: 'note-created',
        id: note.id,
        filename: note.filename,
        author: 'human',
      })
    }
    await new Promise((r) => setTimeout(r, 80))
    expect(spawner.calls.length).toBeGreaterThanOrEqual(3)
    expect(maxInFlight).toBe(1)
    handle.stop()
  })

  it('skips a task that is already claimed by someone else', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({ exitCode: 0 }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })
    const sessionDir = join(notesRoot, note.sessionId)
    // Pre-claim by an external worker
    appendStatus(sessionDir, {
      ts: new Date().toISOString(),
      noteId: note.id,
      from: null,
      to: 'claimed',
      by: 'llm',
      reason: 'other-worker',
    })

    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))

    expect(spawner.calls).toHaveLength(0)
    handle.stop()
  })

  it('stop() prevents further task pickup', async () => {
    const bus = createEventBus()
    const spawner = mockSpawner(async () => ({ exitCode: 0 }))
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner,
      log: () => {},
    })
    handle.stop()
    const note = createNote(notesRoot, { body: 'fix', frontmatter: fmTask, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(spawner.calls).toHaveLength(0)
  })
})
