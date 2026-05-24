import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
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
}

let notesRoot: string
let mcp: LluiMcpServer

beforeEach(() => {
  notesRoot = mkdtempSync(join(tmpdir(), 'llui-mcp-notes-test-'))
  // Pass an out-of-range port so the bridge never starts during these
  // tests (we only exercise tool dispatch, not the WS server).
  mcp = new LluiMcpServer({ bridgePort: 0, notesRoot })
})

afterEach(() => {
  rmSync(notesRoot, { recursive: true, force: true })
})

describe('llui_current_session', () => {
  it('returns the active session metadata', async () => {
    const result = (await mcp.handleToolCall('llui_current_session', {})) as {
      sessionId: string
      startedAt: string
      notesDir: string
    }
    expect(result.sessionId).toMatch(/^session-/)
    expect(result.notesDir.startsWith(notesRoot)).toBe(true)
  })
})

describe('llui_list_notes', () => {
  it('lists notes created via the store', async () => {
    createNote(notesRoot, { body: 'first', frontmatter: fmBase, noteBody: {} })
    createNote(notesRoot, { body: 'second', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_list_notes', {})) as {
      notes: Array<{ id: string; preview: string }>
      total: number
    }
    expect(result.total).toBe(2)
    expect(result.notes.map((n) => n.id)).toEqual(['001', '002'])
  })

  it('filters by author', async () => {
    createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: {} })
    createNote(notesRoot, {
      body: 'b',
      frontmatter: { ...fmBase, author: 'llm' },
      noteBody: {},
    })
    const result = (await mcp.handleToolCall('llui_list_notes', { author: 'llm' })) as {
      notes: Array<{ author: string }>
    }
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]!.author).toBe('llm')
  })

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      createNote(notesRoot, { body: `n${i}`, frontmatter: fmBase, noteBody: {} })
    }
    const result = (await mcp.handleToolCall('llui_list_notes', { limit: 2 })) as {
      notes: unknown[]
      total: number
    }
    expect(result.notes).toHaveLength(2)
    expect(result.total).toBe(5)
  })
})

describe('llui_read_note', () => {
  it('returns frontmatter, prose, body, and raw markdown', async () => {
    const created = createNote(notesRoot, {
      body: 'inspect me',
      frontmatter: fmBase,
      noteBody: { messageLog: [{ ts: 't', component: 'X', msg: { type: 'M' } }] },
    })
    const result = (await mcp.handleToolCall('llui_read_note', { id: created.id })) as {
      frontmatter: { id: string }
      prose: string
      body: { messageLog: unknown[] }
      markdown: string
    }
    expect(result.frontmatter.id).toBe('001')
    expect(result.prose.trim()).toBe('inspect me')
    expect(result.body.messageLog).toHaveLength(1)
    expect(result.markdown.startsWith('---\n')).toBe(true)
  })

  it('throws on unknown id', async () => {
    await expect(mcp.handleToolCall('llui_read_note', { id: '999' })).rejects.toThrow(/not found/i)
  })
})

describe('llui_list_sessions', () => {
  it('returns the list of session directories', async () => {
    createNote(notesRoot, { body: 'a', frontmatter: fmBase, noteBody: {} })
    const result = (await mcp.handleToolCall('llui_list_sessions', {})) as {
      sessions: string[]
    }
    expect(result.sessions.length).toBeGreaterThanOrEqual(1)
    expect(result.sessions[0]!.startsWith('session-')).toBe(true)
  })
})

describe('llui_rotate_session', () => {
  it('starts a new session and reports the previous id', async () => {
    const before = (await mcp.handleToolCall('llui_current_session', {})) as { sessionId: string }
    const rotated = (await mcp.handleToolCall('llui_rotate_session', {})) as {
      sessionId: string
      previousSessionId: string
    }
    expect(rotated.previousSessionId).toBe(before.sessionId)
    // The new sessionId may coincide with the previous one if the
    // wall-clock minute hasn't advanced, but the marker should have
    // been re-written either way. Sanity:
    const sessions = (
      (await mcp.handleToolCall('llui_list_sessions', {})) as { sessions: string[] }
    ).sessions
    expect(sessions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('notesRoot resolution', () => {
  it('honors an explicit notesRoot option', async () => {
    const result = (await mcp.handleToolCall('llui_current_session', {})) as { notesDir: string }
    expect(result.notesDir.startsWith(notesRoot)).toBe(true)
  })

  it('writes the session marker file under the configured root', async () => {
    await mcp.handleToolCall('llui_current_session', {})
    const entries = readdirSync(notesRoot)
    expect(entries).toContain('current-session')
  })
})

describe('tool registration', () => {
  it('exposes all five notes tools in the registry', () => {
    const tools = mcp.getTools().map((t) => t.name)
    expect(tools).toContain('llui_list_notes')
    expect(tools).toContain('llui_read_note')
    expect(tools).toContain('llui_list_sessions')
    expect(tools).toContain('llui_current_session')
    expect(tools).toContain('llui_rotate_session')
  })
})
