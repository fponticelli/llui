import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCaptureRegistry } from '../src/notes/capture-registry.js'
import { createEventBus } from '../src/notes/event-bus.js'
import { createNotesMiddleware } from '../src/notes/middleware.js'
import { createTrustedTaskRegistry } from '../src/notes/trusted-tasks.js'
import { startRouter } from '../src/notes/router.js'
import { createNote } from '../src/notes/store.js'
import type { CreateNoteRequest, NoteFrontmatter } from '../src/notes/types.js'

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
  server: Server
  port: number
  bus: ReturnType<typeof createEventBus>
  trusted: ReturnType<typeof createTrustedTaskRegistry>
}

function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-sec-test-'))
  const bus = createEventBus()
  const registry = createCaptureRegistry()
  const trusted = createTrustedTaskRegistry()
  const handler = createNotesMiddleware({
    notesRoot,
    bus,
    registry,
    trustedTasks: trusted,
    defaultCaptureTimeoutMs: 1000,
  })
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404
      res.end('not in /_llui')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({ notesRoot, server, port: addr.port, bus, trusted })
    })
  })
}

function stopFixture(f: Fixture): Promise<void> {
  rmSync(f.notesRoot, { recursive: true, force: true })
  return new Promise((resolve) => f.server.close(() => resolve()))
}

/**
 * Raw HTTP request that lets us set forbidden headers (Host, Origin,
 * Sec-Fetch-Site) which `fetch`/undici would strip. Returns the status
 * code and parsed-or-raw body.
 */
function raw(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers: opts.headers ?? {} },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

let f: Fixture
beforeEach(async () => {
  f = await startFixture()
})
afterEach(async () => {
  await stopFixture(f)
})

describe('CSRF / same-origin guard', () => {
  const notePayload: CreateNoteRequest = { body: 'x', frontmatter: fmBase, noteBody: {} }

  it('rejects a cross-site Origin on a mutating POST', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        origin: 'https://evil.example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(403)
    expect(res.body).toMatch(/cross-origin|rejected/i)
  })

  it('rejects a Sec-Fetch-Site: cross-site request', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(403)
  })

  it('rejects a non-loopback Host header', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: 'evil.example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(403)
  })

  it('allows a same-origin loopback POST (no Origin header)', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: { host: `127.0.0.1:${f.port}`, 'content-type': 'application/json' },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(201)
  })

  it('allows a same-origin loopback POST with matching Origin', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        origin: `http://127.0.0.1:${f.port}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(201)
  })

  it('does not gate read-only GETs', async () => {
    const res = await raw(f.port, 'GET', '/_llui/notes', {
      headers: { host: 'evil.example.com', origin: 'https://evil.example.com' },
    })
    expect(res.status).toBe(200)
  })

  it('rejects a non-application/json content type on a JSON route', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: { host: `127.0.0.1:${f.port}`, 'content-type': 'text/plain' },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(415)
  })

  it('rejects a 0.0.0.0 Host (not a loopback authority)', async () => {
    // 0.0.0.0 is the unspecified/all-interfaces bind address, not loopback —
    // a request claiming it is not provably same-machine and must be rejected.
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: { host: `0.0.0.0:${f.port}`, 'content-type': 'application/json' },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(403)
    expect(res.body).toMatch(/non-loopback Host|rejected/i)
  })

  it('rejects a 0.0.0.0 Origin as cross-origin', async () => {
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        origin: `http://0.0.0.0:${f.port}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(notePayload),
    })
    expect(res.status).toBe(403)
  })
})

describe('request body size cap', () => {
  it('rejects an oversized JSON body with 413 (declared Content-Length)', async () => {
    // A declared Content-Length over the 32 MB cap is rejected before a byte
    // of the body is read.
    const res = await raw(f.port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        'content-type': 'application/json',
        'content-length': String(64 * 1024 * 1024),
      },
      body: '{}',
    })
    expect(res.status).toBe(413)
  })

  it('caps the /import upload body with 413', async () => {
    // The /import route buffers the raw zip bytes; the same body cap bounds
    // it. A declared Content-Length over the cap is rejected up front.
    const res = await raw(f.port, 'POST', '/_llui/import', {
      headers: {
        host: `127.0.0.1:${f.port}`,
        'content-length': String(64 * 1024 * 1024),
      },
      body: 'x',
    })
    expect(res.status).toBe(413)
  })
})

describe('sessionId path traversal', () => {
  it('rejects a `..`-escaping sessionId on /status', async () => {
    const res = await raw(
      f.port,
      'GET',
      `/_llui/notes/001/status?sessionId=${encodeURIComponent('../../etc')}`,
      { headers: { host: `127.0.0.1:${f.port}` } },
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatch(/invalid sessionId/)
  })

  it('rejects a `..`-escaping sessionId on /queue', async () => {
    const res = await raw(
      f.port,
      'GET',
      `/_llui/queue?sessionId=${encodeURIComponent('../../../tmp')}`,
      { headers: { host: `127.0.0.1:${f.port}` } },
    )
    expect(res.status).toBe(400)
  })

  it('rejects an absolute sessionId on /status', async () => {
    const res = await raw(
      f.port,
      'GET',
      `/_llui/notes/001/status?sessionId=${encodeURIComponent('/etc')}`,
      { headers: { host: `127.0.0.1:${f.port}` } },
    )
    expect(res.status).toBe(400)
  })
})

describe('revert path containment', () => {
  async function post(path: string, body: unknown): Promise<{ status: number; body: string }> {
    return raw(f.port, 'POST', path, {
      headers: { host: `127.0.0.1:${f.port}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('does not delete a file outside the project root via an absolute proposedDiff path', async () => {
    // Sentinel file well outside process.cwd() (the revert projectRoot).
    const sentinelDir = mkdtempSync(join(tmpdir(), 'llui-sentinel-'))
    const sentinel = join(sentinelDir, 'keep.txt')
    writeFileSync(sentinel, 'do not delete')
    try {
      const task = await post('/_llui/notes', {
        body: 'task',
        frontmatter: { ...fmBase, intent: 'task' },
        noteBody: {},
      })
      const taskId = (JSON.parse(task.body) as { id: string }).id
      // Reply note carrying a malicious absolute path in its proposedDiff.
      await post('/_llui/notes', {
        body: 'reply',
        frontmatter: {
          ...fmBase,
          kind: 'reply',
          replyTo: taskId,
          proposedDiff: {
            summary: 'evil',
            confidence: 'high',
            files: [{ path: sentinel, patch: '' }],
          },
        },
        noteBody: {},
      })
      // 'rejected' (which drives the revert) is only reachable from 'proposed'.
      await post(`/_llui/notes/${taskId}/status`, { to: 'claimed' })
      await post(`/_llui/notes/${taskId}/status`, { to: 'proposed' })
      const rej = await post(`/_llui/notes/${taskId}/status`, { to: 'rejected' })
      expect(rej.status).toBe(200)
      // The sentinel must survive — containment rejected the escape.
      expect(existsSync(sentinel)).toBe(true)
      const parsed = JSON.parse(rej.body) as { revert?: { ok: boolean; reason?: string } }
      expect(parsed.revert?.ok).toBe(false)
      expect(parsed.revert?.reason ?? '').toMatch(/escape/i)
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true })
    }
  })

  it('rejects a `..`-climbing relative proposedDiff path', async () => {
    const task = await post('/_llui/notes', {
      body: 'task',
      frontmatter: { ...fmBase, intent: 'task' },
      noteBody: {},
    })
    const taskId = (JSON.parse(task.body) as { id: string }).id
    await post('/_llui/notes', {
      body: 'reply',
      frontmatter: {
        ...fmBase,
        kind: 'reply',
        replyTo: taskId,
        proposedDiff: {
          summary: 'evil',
          confidence: 'high',
          files: [{ path: '../../../../etc/hosts', patch: '' }],
        },
      },
      noteBody: {},
    })
    await post(`/_llui/notes/${taskId}/status`, { to: 'claimed' })
    await post(`/_llui/notes/${taskId}/status`, { to: 'proposed' })
    const rej = await post(`/_llui/notes/${taskId}/status`, { to: 'rejected' })
    const parsed = JSON.parse(rej.body) as { revert?: { ok: boolean } }
    expect(parsed.revert?.ok).toBe(false)
  })
})

describe('task-spawn capability token (S2)', () => {
  // A task note is only marked trusted (→ the router may spawn a local CLI
  // agent) when the request presents the per-launch capability token. A
  // same-origin page script passes the CSRF/loopback guard but cannot read
  // the token, so a forged task POST must NOT become trusted.
  const CAP = 'the-secret-capability-token'

  interface CapFixture {
    notesRoot: string
    server: Server
    port: number
    trusted: ReturnType<typeof createTrustedTaskRegistry>
  }

  async function startCapFixture(): Promise<CapFixture> {
    const notesRoot = mkdtempSync(join(tmpdir(), 'llui-cap-test-'))
    const bus = createEventBus()
    const registry = createCaptureRegistry()
    const trusted = createTrustedTaskRegistry()
    const handler = createNotesMiddleware({
      notesRoot,
      bus,
      registry,
      trustedTasks: trusted,
      taskCapabilityToken: CAP,
      defaultCaptureTimeoutMs: 1000,
    })
    const server = createServer((req, res) => {
      handler(req, res, () => {
        res.statusCode = 404
        res.end('not in /_llui')
      })
    })
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        resolve({ notesRoot, server, port: addr.port, trusted })
      })
    })
  }

  function postTask(
    port: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    return raw(port, 'POST', '/_llui/notes', {
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
  }

  const taskBody = { body: 'do a task', frontmatter: { ...fmBase, intent: 'task' }, noteBody: {} }

  it('does NOT mark a forged same-origin task POST (no token) trusted', async () => {
    const cf = await startCapFixture()
    try {
      const res = await postTask(cf.port, taskBody)
      expect(res.status).toBe(201)
      const created = JSON.parse(res.body) as { id: string; sessionId: string }
      // The note is created and enters the queue, but is NOT trusted.
      expect(cf.trusted.isTrusted(created.sessionId, created.id)).toBe(false)
    } finally {
      rmSync(cf.notesRoot, { recursive: true, force: true })
      await new Promise<void>((r) => cf.server.close(() => r()))
    }
  })

  it('rejects a WRONG capability token', async () => {
    const cf = await startCapFixture()
    try {
      const res = await postTask(cf.port, taskBody, { 'x-llui-task-capability': 'wrong' })
      const created = JSON.parse(res.body) as { id: string; sessionId: string }
      expect(cf.trusted.isTrusted(created.sessionId, created.id)).toBe(false)
    } finally {
      rmSync(cf.notesRoot, { recursive: true, force: true })
      await new Promise<void>((r) => cf.server.close(() => r()))
    }
  })

  it('marks a task trusted when the correct capability token is presented', async () => {
    const cf = await startCapFixture()
    try {
      const res = await postTask(cf.port, taskBody, { 'x-llui-task-capability': CAP })
      const created = JSON.parse(res.body) as { id: string; sessionId: string }
      expect(cf.trusted.isTrusted(created.sessionId, created.id)).toBe(true)
    } finally {
      rmSync(cf.notesRoot, { recursive: true, force: true })
      await new Promise<void>((r) => cf.server.close(() => r()))
    }
  })
})

describe('router task provenance', () => {
  it('does not spawn for a note whose id was never marked trusted', async () => {
    const notesRoot = mkdtempSync(join(tmpdir(), 'llui-prov-'))
    const bus = createEventBus()
    const trusted = createTrustedTaskRegistry()
    let spawned = 0
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      trustedTasks: trusted,
      spawner: {
        spawn: async () => {
          spawned++
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })
    try {
      // A forged task note reaches disk directly (not via authenticated
      // middleware), so it is never marked in the registry.
      const note = createNote(notesRoot, {
        body: 'forged',
        frontmatter: { ...fmBase, intent: 'task' },
        noteBody: {},
      })
      bus.broadcast({
        type: 'note-created',
        id: note.id,
        filename: note.filename,
        author: 'human',
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(spawned).toBe(0)
    } finally {
      handle.stop()
      rmSync(notesRoot, { recursive: true, force: true })
    }
  })

  it('spawns for a note that was marked trusted', async () => {
    const notesRoot = mkdtempSync(join(tmpdir(), 'llui-prov-'))
    const bus = createEventBus()
    const trusted = createTrustedTaskRegistry()
    let spawned = 0
    const handle = startRouter({
      notesRoot,
      projectRoot: notesRoot,
      bus,
      trustedTasks: trusted,
      spawner: {
        spawn: async () => {
          spawned++
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })
    try {
      const note = createNote(notesRoot, {
        body: 'legit',
        frontmatter: { ...fmBase, intent: 'task' },
        noteBody: {},
      })
      trusted.mark(note.sessionId, note.id)
      bus.broadcast({
        type: 'note-created',
        id: note.id,
        filename: note.filename,
        author: 'human',
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(spawned).toBe(1)
    } finally {
      handle.stop()
      rmSync(notesRoot, { recursive: true, force: true })
    }
  })
})
