import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNote,
  listNotes,
  listSessions,
  readNote,
  readScreenshot,
} from '../src/notes/store.js'
import { resolveCurrentSession } from '../src/notes/session.js'
import type { NoteBody, NoteFrontmatter } from '../src/notes/types.js'

let notesRoot: string

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-notes-store-'))
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

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
}

const emptyBody: NoteBody = {}

describe('createNote', () => {
  it('assigns id 001 to the first note in a session and writes the file', () => {
    const res = createNote(notesRoot, {
      body: 'First note prose.',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    expect(res.id).toBe('001')
    expect(res.filename).toMatch(/^001-human-text-/)
    expect(res.filename.endsWith('.md')).toBe(true)
    expect(existsSync(res.path)).toBe(true)
  })

  it('increments id for subsequent notes', () => {
    const a = createNote(notesRoot, { body: 'first', frontmatter: fmBase, noteBody: emptyBody })
    const b = createNote(notesRoot, { body: 'second', frontmatter: fmBase, noteBody: emptyBody })
    const c = createNote(notesRoot, { body: 'third', frontmatter: fmBase, noteBody: emptyBody })
    expect(a.id).toBe('001')
    expect(b.id).toBe('002')
    expect(c.id).toBe('003')
  })

  it('derives slug from prose', () => {
    const res = createNote(notesRoot, {
      body: 'The Edit button copy is wrong',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    // stopwords stripped, kebab-cased
    expect(res.filename).toBe('001-human-text-edit-button-copy-wrong.md')
  })

  it('uses "capture" slug when prose is empty', () => {
    const res = createNote(notesRoot, {
      body: '',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    expect(res.filename).toBe('001-human-text-capture.md')
  })

  it('writes a sibling .png when screenshot is provided', () => {
    // a tiny 1x1 transparent PNG, base64
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const res = createNote(notesRoot, {
      body: 'with shot',
      frontmatter: { ...fmBase, kind: 'rect', screenshot: 'placeholder.png' },
      noteBody: emptyBody,
      screenshot: pngBase64,
    })
    const dir = join(notesRoot, res.sessionId)
    const pngPath = join(dir, res.filename.replace(/\.md$/, '.png'))
    expect(existsSync(pngPath)).toBe(true)
    // The frontmatter.screenshot field is rewritten by the store to
    // match the actual filename derived from the note's id+slug.
    const parsed = readNote(notesRoot, res.sessionId, res.id)
    expect(parsed.frontmatter.screenshot).toBe(res.filename.replace(/\.md$/, '.png'))
  })

  it('embeds frontmatter ts on disk', () => {
    const res = createNote(notesRoot, {
      body: 'tcheck',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    const md = readFileSync(res.path, 'utf8')
    expect(md).toMatch(/ts: /)
  })

  it('handles filename collisions with a -2 suffix', () => {
    const a = createNote(notesRoot, {
      body: 'same words',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    // Inject a fake collision file with the natural-name shape for the next id
    const sessionDir = join(notesRoot, a.sessionId)
    writeFileSync(
      join(sessionDir, '002-human-text-same-words.md'),
      '---\nfake: 1\n---\n\n```json\n{}\n```\n',
    )
    const b = createNote(notesRoot, {
      body: 'same words',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    expect(b.id).toBe('003') // id allocation skips past the conflicting file's number
  })
})

describe('readNote', () => {
  it('round-trips a created note', () => {
    const res = createNote(notesRoot, {
      body: 'round trip',
      frontmatter: fmBase,
      noteBody: { messageLog: [{ ts: 't', component: 'C', msg: { type: 'X' } }] },
    })
    const parsed = readNote(notesRoot, res.sessionId, res.id)
    expect(parsed.frontmatter.id).toBe('001')
    expect(parsed.frontmatter.author).toBe('human')
    expect(parsed.body.messageLog).toHaveLength(1)
    expect(parsed.prose.trim()).toBe('round trip')
  })

  it('throws when the note does not exist', () => {
    const { sessionId } = resolveCurrentSession(notesRoot, {})
    expect(() => readNote(notesRoot, sessionId, '999')).toThrow(/not found/i)
  })
})

describe('listNotes', () => {
  it('returns notes in session in ascending id order', () => {
    const a = createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: emptyBody })
    const b = createNote(notesRoot, { body: 'b', frontmatter: fmBase, noteBody: emptyBody })
    const c = createNote(notesRoot, { body: 'c', frontmatter: fmBase, noteBody: emptyBody })
    const list = listNotes(notesRoot, { sessionId: a.sessionId })
    expect(list.notes.map((n) => n.id)).toEqual(['001', '002', '003'])
    expect(list.total).toBe(3)
    // hasScreenshot is false (none provided)
    expect(list.notes.every((n) => !n.hasScreenshot)).toBe(true)
    // sanity
    expect(b.id).toBe('002')
    expect(c.id).toBe('003')
  })

  it('filters by author', () => {
    createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: emptyBody })
    createNote(notesRoot, {
      body: 'b',
      frontmatter: { ...fmBase, author: 'llm' },
      noteBody: emptyBody,
    })
    const list = listNotes(notesRoot, { author: 'llm' })
    expect(list.notes).toHaveLength(1)
    expect(list.notes[0]!.author).toBe('llm')
  })

  it('filters by kind (single and array)', () => {
    createNote(notesRoot, {
      body: 'a',
      frontmatter: { ...fmBase, kind: 'text' },
      noteBody: emptyBody,
    })
    createNote(notesRoot, {
      body: 'b',
      frontmatter: { ...fmBase, kind: 'rect' },
      noteBody: emptyBody,
    })
    createNote(notesRoot, {
      body: 'c',
      frontmatter: { ...fmBase, kind: 'lasso' },
      noteBody: emptyBody,
    })
    expect(listNotes(notesRoot, { kind: 'rect' }).notes).toHaveLength(1)
    expect(listNotes(notesRoot, { kind: ['rect', 'lasso'] }).notes).toHaveLength(2)
  })

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      createNote(notesRoot, { body: `n${i}`, frontmatter: fmBase, noteBody: emptyBody })
    }
    const list = listNotes(notesRoot, { limit: 2 })
    expect(list.notes).toHaveLength(2)
    expect(list.total).toBe(5)
  })

  it('preview is the trimmed first slice of prose', () => {
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(5)
    createNote(notesRoot, { body: long, frontmatter: fmBase, noteBody: emptyBody })
    const list = listNotes(notesRoot, {})
    expect(list.notes[0]!.preview.length).toBeLessThanOrEqual(80)
    expect(list.notes[0]!.preview.startsWith('The quick brown')).toBe(true)
  })

  it('returns empty list when session has no notes', () => {
    resolveCurrentSession(notesRoot, {})
    expect(listNotes(notesRoot, {}).notes).toEqual([])
  })

  it('returns empty list when notesRoot does not exist yet', () => {
    rmSync(notesRoot, { recursive: true, force: true })
    expect(listNotes(notesRoot, {})).toEqual({ sessionId: '', notes: [], total: 0 })
  })
})

describe('listSessions', () => {
  it('lists every session subdir', () => {
    createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: emptyBody })
    expect(listSessions(notesRoot).length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty array when notesRoot does not exist', () => {
    rmSync(notesRoot, { recursive: true, force: true })
    expect(listSessions(notesRoot)).toEqual([])
  })
})

describe('readScreenshot', () => {
  it('returns the screenshot bytes when present', () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const res = createNote(notesRoot, {
      body: 'shot',
      frontmatter: { ...fmBase, kind: 'rect', screenshot: 'x.png' },
      noteBody: emptyBody,
      screenshot: pngBase64,
    })
    const bytes = readScreenshot(notesRoot, res.sessionId, res.id)
    expect(bytes).not.toBe(null)
    expect(bytes!.length).toBeGreaterThan(0)
  })

  it('returns null when no screenshot', () => {
    const res = createNote(notesRoot, { body: 'noshot', frontmatter: fmBase, noteBody: emptyBody })
    expect(readScreenshot(notesRoot, res.sessionId, res.id)).toBe(null)
  })
})

describe('session dir contents', () => {
  it('writes all .md notes into the current session directory', () => {
    const res = createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: emptyBody })
    const sessDir = join(notesRoot, res.sessionId)
    const entries = readdirSync(sessDir)
    expect(entries.some((f) => f.endsWith('.md'))).toBe(true)
  })
})

describe('updateNoteProse + deleteNote', () => {
  it('updateNoteProse replaces only the body, keeping frontmatter intact', async () => {
    const res = createNote(notesRoot, {
      body: 'original text',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    const { updateNoteProse, readNote: read } = await import('../src/notes/store.js')
    const updated = updateNoteProse(notesRoot, res.sessionId, res.id, 'rewritten text')
    expect(updated.prose).toBe('rewritten text')
    expect(updated.frontmatter.id).toBe(res.id)
    expect(updated.frontmatter.author).toBe('human')
    // Round-trip through disk to confirm the change persisted.
    const fromDisk = read(notesRoot, res.sessionId, res.id)
    expect(fromDisk.prose).toBe('rewritten text')
    expect(fromDisk.frontmatter.id).toBe(res.id)
  })

  it('updateNoteProse throws when the note is missing', async () => {
    const { updateNoteProse } = await import('../src/notes/store.js')
    const probeSession = createNote(notesRoot, {
      body: 'seed',
      frontmatter: fmBase,
      noteBody: emptyBody,
    }).sessionId
    expect(() => updateNoteProse(notesRoot, probeSession, '999', 'nope')).toThrow(/not found/)
  })

  it('deleteNote removes the .md (and .png if present) and returns the paths', async () => {
    const res = createNote(notesRoot, {
      body: 'doomed',
      frontmatter: fmBase,
      noteBody: emptyBody,
      screenshot:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    })
    const { deleteNote } = await import('../src/notes/store.js')
    const sessionDir = join(notesRoot, res.sessionId)
    const before = readdirSync(sessionDir)
    expect(before.some((f) => f.endsWith('.md'))).toBe(true)
    expect(before.some((f) => f.endsWith('.png'))).toBe(true)

    const removed = deleteNote(notesRoot, res.sessionId, res.id)
    expect(removed.length).toBe(2) // .md + .png

    const after = readdirSync(sessionDir)
    expect(after.some((f) => f.startsWith(res.id))).toBe(false)
  })

  it('deleteNote is idempotent on a missing id', async () => {
    const { deleteNote } = await import('../src/notes/store.js')
    const probeSession = createNote(notesRoot, {
      body: 'seed',
      frontmatter: fmBase,
      noteBody: emptyBody,
    }).sessionId
    expect(deleteNote(notesRoot, probeSession, '999')).toEqual([])
  })
})

describe('format overrides', () => {
  it('formatSessionFolder controls the session directory name', () => {
    const res = createNote(
      notesRoot,
      { body: 'a', frontmatter: fmBase, noteBody: emptyBody },
      { formatSessionFolder: (d) => `custom-${d.getUTCFullYear()}` },
    )
    expect(res.sessionId.startsWith('custom-')).toBe(true)
    expect(existsSync(join(notesRoot, res.sessionId))).toBe(true)
  })

  it('deriveSlug controls the slug portion of the filename', () => {
    const res = createNote(
      notesRoot,
      { body: 'hello world', frontmatter: fmBase, noteBody: emptyBody },
      { deriveSlug: () => 'forced-slug' },
    )
    expect(res.filename).toMatch(/^\d{3,}-human-text-forced-slug\.md$/)
  })

  it('default behavior unchanged when no format is passed', () => {
    const res = createNote(notesRoot, {
      body: 'edit button copy',
      frontmatter: fmBase,
      noteBody: emptyBody,
    })
    expect(res.sessionId).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{4}$/)
    expect(res.filename).toMatch(/^\d{3,}-human-text-edit-button-copy\.md$/)
  })
})
