// Tests for the MCP resources (P3b). Resources are listed and read via
// the SDK's internal handlers — we drive them by spinning up an MCP
// server with an in-process transport pair.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
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

interface Fixture {
  notesRoot: string
  mcp: LluiMcpServer
  client: Client
}

async function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-mcp-res-'))
  const mcp = new LluiMcpServer({ bridgePort: 0, notesRoot })
  const sessionMcp = mcp.createSessionMcp()
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await sessionMcp.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} })
  await client.connect(clientTransport)
  return { notesRoot, mcp, client }
}

async function stopFixture(f: Fixture): Promise<void> {
  await f.client.close()
  rmSync(f.notesRoot, { recursive: true, force: true })
}

let f: Fixture

beforeEach(async () => {
  f = await startFixture()
})

afterEach(async () => {
  await stopFixture(f)
})

describe('MCP notes resources', () => {
  it('lists registered resource URIs via resources/list', async () => {
    const res = await f.client.listResources()
    const uris = res.resources.map((r) => r.uri)
    expect(uris).toContain('llui://sessions')
    expect(uris).toContain('llui://session/current')
  })

  it('reads llui://sessions and returns the on-disk session list', async () => {
    createNote(f.notesRoot, { body: 'a', frontmatter: fmBase, noteBody: {} })
    const res = await f.client.readResource({ uri: 'llui://sessions' })
    expect(res.contents).toHaveLength(1)
    const payload = JSON.parse((res.contents[0] as { text: string }).text) as { sessions: string[] }
    expect(payload.sessions.length).toBeGreaterThanOrEqual(1)
    expect(payload.sessions[0]!.startsWith('session-')).toBe(true)
  })

  it('reads llui://session/current with note index inline', async () => {
    createNote(f.notesRoot, { body: 'one', frontmatter: fmBase, noteBody: {} })
    createNote(f.notesRoot, { body: 'two', frontmatter: fmBase, noteBody: {} })
    const res = await f.client.readResource({ uri: 'llui://session/current' })
    const payload = JSON.parse((res.contents[0] as { text: string }).text) as {
      sessionId: string
      notes: Array<{ id: string }>
    }
    expect(payload.sessionId).toMatch(/^session-/)
    expect(payload.notes).toHaveLength(2)
    expect(payload.notes.map((n) => n.id)).toEqual(['001', '002'])
  })

  it('reads llui://session/{id} for a specific session', async () => {
    const created = createNote(f.notesRoot, { body: 'a', frontmatter: fmBase, noteBody: {} })
    const res = await f.client.readResource({
      uri: `llui://session/${created.sessionId}`,
    })
    const payload = JSON.parse((res.contents[0] as { text: string }).text) as {
      sessionId: string
      notes: Array<{ id: string }>
      total: number
    }
    expect(payload.sessionId).toBe(created.sessionId)
    expect(payload.total).toBe(1)
  })

  it('reads llui://session/{id}/note/{noteId} and returns raw markdown', async () => {
    const created = createNote(f.notesRoot, {
      body: 'inspect',
      frontmatter: fmBase,
      noteBody: {},
    })
    const res = await f.client.readResource({
      uri: `llui://session/${created.sessionId}/note/${created.id}`,
    })
    expect(res.contents[0]!.mimeType).toBe('text/markdown')
    const md = (res.contents[0] as { text: string }).text
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('inspect')
  })
})
