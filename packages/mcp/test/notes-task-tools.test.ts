import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNote } from '@llui/vite-plugin/notes'
import type { NoteFrontmatter } from '@llui/vite-plugin'
import { LluiMcpServer } from '../src/index'

const fmBase: Omit<NoteFrontmatter, 'id' | 'ts'> = {
  author: 'human',
  kind: 'text',
  captureLevel: 'standard',
  url: 'http://localhost:5173/',
  route: '/',
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

let notesRoot: string
let mcp: LluiMcpServer

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-mcp-tasks-'))
  mcp = new LluiMcpServer({ bridgePort: 0, notesRoot })
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

describe('llui_queue', () => {
  it('returns an empty queue when no transitions exist', async () => {
    const result = (await mcp.handleToolCall('llui_queue', {})) as {
      queue: unknown[]
    }
    expect(result.queue).toEqual([])
  })
})

describe('llui_claim_note', () => {
  it('claims an unowned task note', async () => {
    const note = createNote(notesRoot, { body: 'task', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_claim_note', {
      noteId: note.id,
      workerId: 'worker-1',
    })) as { status: string; noteId: string }
    expect(result.status).toBe('claimed')
    expect(result.noteId).toBe(note.id)
  })

  it('returns already-claimed-by on second claim attempt', async () => {
    const note = createNote(notesRoot, { body: 'task', frontmatter: fmBase, noteBody: {} })
    await mcp.handleToolCall('llui_claim_note', {
      noteId: note.id,
      workerId: 'worker-1',
    })
    const result = (await mcp.handleToolCall('llui_claim_note', {
      noteId: note.id,
      workerId: 'worker-2',
    })) as { status: string; currentStatus: string }
    expect(result.status).toBe('already-claimed-by')
    expect(result.currentStatus).toBe('claimed')
  })

  it('honors a lock another worker holds even before its transition is written', async () => {
    // Reproduces the cross-process race: worker A won the exclusive claim
    // lock but has not yet appended its `claimed` transition. Worker B (this
    // process) sees status still `null`/open, but the lock file arbitrates —
    // B must NOT double-claim. The old read-then-append had no arbiter and
    // both workers would win.
    const note = createNote(notesRoot, { body: 'task', frontmatter: fmBase, noteBody: {} })
    const sessionDir = join(notesRoot, note.sessionId)
    // Simulate worker A's in-flight claim: the lock exists, the JSONL does not.
    writeFileSync(
      join(sessionDir, `${note.id}.claim`),
      JSON.stringify({ workerId: 'worker-A', ts: '2026-01-01T00:00:00Z' }),
    )
    const result = (await mcp.handleToolCall('llui_claim_note', {
      noteId: note.id,
      workerId: 'worker-B',
    })) as { status: string; by: string | null }
    expect(result.status).toBe('already-claimed-by')
    expect(result.by).toBe('worker-A')
  })
})

describe('llui_reply_to_note', () => {
  it('writes a reply note with kind:reply and replyTo set', async () => {
    const note = createNote(notesRoot, { body: 'fix copy', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_reply_to_note', {
      replyTo: note.id,
      prose: "here's a fix",
    })) as { replyNoteId: string; filename: string }
    expect(result.replyNoteId).toBe('002') // 001 was the task, 002 is the reply
    expect(result.filename).toMatch(/^002-llm-reply-/)
  })

  it('bumps the original task status to "proposed" when proposedDiff is included', async () => {
    const note = createNote(notesRoot, { body: 'fix copy', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_reply_to_note', {
      replyTo: note.id,
      prose: 'fix',
      proposedDiff: {
        files: [{ path: 'src/x.ts', patch: 'patch text' }],
        summary: 'rename foo to bar',
        confidence: 'high',
      },
    })) as { statusTransition?: { to: string } }
    expect(result.statusTransition?.to).toBe('proposed')

    // Confirm via llui_queue
    const queue = (await mcp.handleToolCall('llui_queue', {
      status: 'proposed',
    })) as { queue: Array<{ noteId: string }> }
    expect(queue.queue).toHaveLength(1)
    expect(queue.queue[0]!.noteId).toBe(note.id)
  })

  it('does NOT bump status when no proposedDiff', async () => {
    const note = createNote(notesRoot, { body: 'q', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_reply_to_note', {
      replyTo: note.id,
      prose: "I don't know",
    })) as { statusTransition?: unknown }
    expect(result.statusTransition).toBeUndefined()
  })
})

describe('tool registration', () => {
  it('exposes all task-mode tools', () => {
    const names = mcp.getTools().map((t) => t.name)
    expect(names).toContain('llui_queue')
    expect(names).toContain('llui_claim_note')
    expect(names).toContain('llui_reply_to_note')
  })
})

describe('sessionId path traversal is rejected', () => {
  const traversals = ['../../etc', '..', '../secret', 'a/../../b', '/etc/passwd']
  for (const bad of traversals) {
    it(`llui_queue rejects ${JSON.stringify(bad)}`, async () => {
      await expect(mcp.handleToolCall('llui_queue', { sessionId: bad })).rejects.toThrow(
        /invalid sessionId/,
      )
    })
    it(`llui_claim_note rejects ${JSON.stringify(bad)}`, async () => {
      await expect(
        mcp.handleToolCall('llui_claim_note', { sessionId: bad, noteId: '001', workerId: 'w' }),
      ).rejects.toThrow(/invalid sessionId/)
    })
    it(`llui_reply_to_note rejects ${JSON.stringify(bad)}`, async () => {
      await expect(
        mcp.handleToolCall('llui_reply_to_note', {
          sessionId: bad,
          replyTo: '001',
          prose: 'x',
          proposedDiff: {
            files: [{ path: 'a', patch: 'b' }],
            summary: 's',
            confidence: 'low' as const,
          },
        }),
      ).rejects.toThrow(/invalid sessionId/)
    })
  }
})
