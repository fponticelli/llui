import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEventBus } from '../src/notes/event-bus.js'
import { createNote } from '../src/notes/store.js'
import { appendStatus, currentStatus, readStatusHistory } from '../src/notes/status.js'
import { resolveCliInvocation, startRouter, type ClaudeSpawner } from '../src/notes/router.js'
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

  it('parses an llui-reply block from stdout and creates a reply note + proposed status', async () => {
    const bus = createEventBus()
    const replyJson = JSON.stringify({
      summary: 'replace Update with Save changes',
      confidence: 'high',
      files: [
        {
          path: 'src/EditButton.ts',
          patch:
            '--- a/src/EditButton.ts\n+++ b/src/EditButton.ts\n@@\n-text("Update")\n+text("Save changes")\n',
        },
      ],
    })
    const stdout = `Read the file. Here's my proposed change.\n\n\`\`\`llui-reply\n${replyJson}\n\`\`\`\n`
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner: mockSpawner(async () => ({ exitCode: 0, stdout })),
      log: () => {},
    })

    const note = createNote(notesRoot, { body: 'fix copy', frontmatter: fmTask, noteBody: {} })
    bus.broadcast({
      type: 'note-created',
      id: note.id,
      filename: note.filename,
      author: 'human',
    })
    await new Promise((r) => setTimeout(r, 10))

    const sessionDir = join(notesRoot, note.sessionId)
    expect(currentStatus(sessionDir, note.id)).toBe('proposed')
    handle.stop()
  })

  it('marks failed when stdout has no llui-reply block', async () => {
    const bus = createEventBus()
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner: mockSpawner(async () => ({
        exitCode: 0,
        stdout: 'I solved it. Look at the file.', // no block!
      })),
      log: () => {},
    })
    const note = createNote(notesRoot, { body: 'a', frontmatter: fmTask, noteBody: {} })
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

  it('marks failed when the llui-reply JSON is malformed', async () => {
    const bus = createEventBus()
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      spawner: mockSpawner(async () => ({
        exitCode: 0,
        stdout: '```llui-reply\n{ not json here\n```',
      })),
      log: () => {},
    })
    const note = createNote(notesRoot, { body: 'a', frontmatter: fmTask, noteBody: {} })
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

describe('resolveCliInvocation', () => {
  const stub = {
    notesRoot: '',
    projectRoot: '',
    bus: {} as unknown as ReturnType<typeof createEventBus>,
  }

  it('claude preset defaults to sonnet', () => {
    const r = resolveCliInvocation({ ...stub, preset: 'claude' })
    expect(r.command).toBe('claude')
    expect(r.args).toContain('--model')
    expect(r.args).toContain('sonnet')
    expect(r.promptVia).toBe('arg')
  })

  it('explicit model overrides the preset default', () => {
    const r = resolveCliInvocation({ ...stub, preset: 'claude', model: 'opus' })
    const modelIdx = r.args.indexOf('--model')
    expect(modelIdx).toBeGreaterThanOrEqual(0)
    expect(r.args[modelIdx + 1]).toBe('opus')
    expect(r.args).not.toContain('sonnet')
  })

  it('codex preset omits --model when no explicit model is given', () => {
    const r = resolveCliInvocation({ ...stub, preset: 'codex' })
    expect(r.command).toBe('codex')
    expect(r.args).not.toContain('--model')
  })

  it('gemini preset routes the prompt via stdin', () => {
    const r = resolveCliInvocation({ ...stub, preset: 'gemini' })
    expect(r.command).toBe('gemini')
    expect(r.promptVia).toBe('stdin')
  })

  it('extraArgs are appended after model + before the prompt', () => {
    const r = resolveCliInvocation({
      ...stub,
      preset: 'claude',
      extraArgs: ['--verbose', '--rate-limit', '5'],
    })
    expect(r.args.slice(-3)).toEqual(['--verbose', '--rate-limit', '5'])
  })

  it('custom command + args path bypasses preset defaults', () => {
    const r = resolveCliInvocation({
      ...stub,
      command: 'my-llm',
      args: ['--quiet'],
      promptVia: 'stdin',
    })
    expect(r.command).toBe('my-llm')
    // No preset means no defaultModel, so --model isn't appended.
    expect(r.args).toEqual(['--quiet'])
    expect(r.promptVia).toBe('stdin')
  })

  it('env vars merge with process.env', () => {
    const r = resolveCliInvocation({
      ...stub,
      preset: 'claude',
      env: { OPENAI_API_KEY: 'sk-test' },
    })
    expect(r.env['OPENAI_API_KEY']).toBe('sk-test')
    // PATH from process.env should still be present (sanity check on merge).
    expect(r.env['PATH']).toBeDefined()
  })
})
