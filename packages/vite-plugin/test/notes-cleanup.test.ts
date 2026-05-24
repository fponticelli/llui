import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { cleanupResolvedTask, createNote } from '../src/notes/store.js'
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

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

let notesRoot: string

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-cleanup-'))
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

describe('cleanupResolvedTask', () => {
  it('deletes the task .md and its sibling .png', () => {
    const task = createNote(notesRoot, {
      body: 'fix the button',
      frontmatter: { ...fmTask, kind: 'rect' },
      noteBody: {},
      screenshot: tinyPng,
    })
    const sessionDir = join(notesRoot, task.sessionId)
    const before = readdirSync(sessionDir).filter((f) => f.startsWith(task.id))
    expect(before.length).toBeGreaterThanOrEqual(2) // .md + .png

    const deleted = cleanupResolvedTask(notesRoot, task.sessionId, task.id)
    expect(deleted.some((f) => f.endsWith('.md'))).toBe(true)
    expect(deleted.some((f) => f.endsWith('.png'))).toBe(true)
    const after = readdirSync(sessionDir).filter((f) => f.startsWith(task.id))
    expect(after).toHaveLength(0)
  })

  it('also deletes reply notes that point at the task', () => {
    const task = createNote(notesRoot, {
      body: 'task',
      frontmatter: fmTask,
      noteBody: {},
    })
    const reply = createNote(notesRoot, {
      body: 'reply',
      frontmatter: {
        ...fmTask,
        author: 'llm',
        kind: 'reply',
        intent: 'note',
        replyTo: task.id,
      },
      noteBody: {},
    })
    const sessionDir = join(notesRoot, task.sessionId)
    expect(existsSync(join(sessionDir, reply.filename))).toBe(true)

    const deleted = cleanupResolvedTask(notesRoot, task.sessionId, task.id)
    expect(deleted).toContain(reply.filename)
    expect(existsSync(join(sessionDir, reply.filename))).toBe(false)
  })

  it('preserves status.jsonl (audit trail stays)', () => {
    const task = createNote(notesRoot, {
      body: 'task',
      frontmatter: fmTask,
      noteBody: {},
    })
    const sessionDir = join(notesRoot, task.sessionId)
    writeFileSync(join(sessionDir, 'status.jsonl'), '{"noteId":"001","to":"open"}\n', 'utf8')
    cleanupResolvedTask(notesRoot, task.sessionId, task.id)
    expect(existsSync(join(sessionDir, 'status.jsonl'))).toBe(true)
  })

  it('preserves unrelated notes (not replies to this task)', () => {
    const a = createNote(notesRoot, { body: 'a', frontmatter: fmTask, noteBody: {} })
    const b = createNote(notesRoot, { body: 'b', frontmatter: fmTask, noteBody: {} })
    const sessionDir = join(notesRoot, a.sessionId)
    cleanupResolvedTask(notesRoot, a.sessionId, a.id)
    expect(existsSync(join(sessionDir, a.filename))).toBe(false)
    expect(existsSync(join(sessionDir, b.filename))).toBe(true)
  })

  it('idempotent — calling on an already-cleaned task returns []', () => {
    const task = createNote(notesRoot, { body: 'a', frontmatter: fmTask, noteBody: {} })
    cleanupResolvedTask(notesRoot, task.sessionId, task.id)
    const second = cleanupResolvedTask(notesRoot, task.sessionId, task.id)
    expect(second).toEqual([])
  })

  it('handles a missing session dir gracefully', () => {
    expect(cleanupResolvedTask(notesRoot, 'session-nonexistent', '001')).toEqual([])
  })
})
