// MCP tools for the devmode-annotate notebook
// (docs/proposals/devmode-annotate/03-mcp-surface.md).
//
// Read-only surface: list/read/sessions/rotate. The write side
// (LLM-initiated capture via `llui_capture`) lands in P5 of the
// proposal together with the Playwright fallback. Until then, the
// human is the only writer; the LLM consumes.
//
// All tools reach the filesystem directly via @llui/vite-plugin/notes —
// no relay or browser bridge required.

import { z } from 'zod'
import {
  appendStatus,
  createNote,
  currentStatus,
  listNotes,
  listQueue,
  listSessions,
  readNote,
  readStatusHistory,
  resolveCurrentSession,
  rotateSession,
  serializeNote,
} from '@llui/vite-plugin/notes'
import type {
  CaptureLevel,
  NoteBody,
  NoteFrontmatter,
  NoteStatus,
  ProposedDiff,
  StatusTransition,
} from '@llui/vite-plugin'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CdpTransport, ToolRegistry } from '../tool-registry.js'

/**
 * Create a note via the dev server's POST /_llui/notes endpoint when
 * available, falling back to a direct `createNote` (which bypasses
 * the project's `format` overrides). Routing through HTTP means
 * MCP-written notes get the same session-folder + slug treatment as
 * HUD-originated writes.
 *
 * The fallback path runs when no dev server is reachable (rare —
 * MCP is normally paired with a running Vite instance via the
 * marker handshake).
 */
async function createNoteViaServerOrDirect(
  devServerUrl: string | null | undefined,
  notesRoot: string,
  request: {
    body: string
    frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'>
    noteBody: NoteBody
    screenshot?: string
  },
): Promise<{ id: string; sessionId: string; filename: string; path: string }> {
  if (devServerUrl) {
    try {
      const res = await fetch(`${devServerUrl}/_llui/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (res.ok) {
        return (await res.json()) as {
          id: string
          sessionId: string
          filename: string
          path: string
        }
      }
      // Non-2xx from dev server — fall through to direct write.
    } catch {
      // Network error → dev server unreachable; fall through.
    }
  }
  return createNote(notesRoot, request)
}

// Expression evaluated in the page context. Mirrors the HUD's
// debug-collector logic — iterates window.__lluiComponents and pulls
// state, message history, pending+recent effects. Returns a NoteBody
// (or {} when no debug API). String form so it serializes across the
// CDP boundary.
const PAGE_TELEMETRY_EXPR = `(() => {
  const components = (globalThis).__lluiComponents
  if (!components) return {}
  const entries = Object.entries(components)
  if (entries.length === 0) return {}
  const stateSnapshot = {}
  const messageLog = []
  const pending = []
  const recent = []
  const now = Date.now()
  for (const [name, api] of entries) {
    try { stateSnapshot[name] = api.getState() } catch { stateSnapshot[name] = { __error: 'getState() threw' } }
    if (typeof api.getMessageHistory === 'function') {
      let history = []
      try { history = api.getMessageHistory({ limit: 50 }) || [] } catch {}
      for (const r of history) {
        messageLog.push({ ts: new Date(r.timestamp).toISOString(), component: name, msg: r.msg })
      }
    }
    if (typeof api.getPendingEffects === 'function') {
      let p = []
      try { p = api.getPendingEffects() || [] } catch {}
      for (const e of p) {
        pending.push({
          id: e.id, component: name,
          effect: e.payload != null ? e.payload : (e.type != null ? e.type : null),
          sinceMs: e.dispatchedAt ? Math.max(0, now - e.dispatchedAt) : 0,
        })
      }
    }
    if (typeof api.getEffectTimeline === 'function') {
      let t = []
      try { t = api.getEffectTimeline(50) || [] } catch {}
      for (const e of t) {
        let outcome = null
        if (e.phase === 'resolved' || e.phase === 'resolved-mocked') outcome = 'ok'
        else if (e.phase === 'cancelled') outcome = 'cancelled'
        else if (e.phase === 'errored' || e.phase === 'error') outcome = 'error'
        if (outcome) recent.push({
          ts: new Date(e.timestamp).toISOString(), component: name,
          effect: { type: e.type != null ? e.type : null, id: e.effectId },
          outcome,
        })
      }
    }
  }
  messageLog.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)
  const trimmed = messageLog.length > 50 ? messageLog.slice(-50) : messageLog
  const body = { stateSnapshot, messageLog: trimmed }
  if (pending.length > 0 || recent.length > 0) body.effects = { pending, recent }
  return body
})()`

interface PageMeta {
  url: string
  viewport: { w: number; h: number; dpr: number }
  componentPath: string[] | null
  componentMeta: { file: string; line: number; name: string } | null
}

const PAGE_META_EXPR = `(() => {
  const comps = globalThis.__lluiComponents
  let componentPath = null
  let componentMeta = null
  if (comps) {
    const entries = Object.entries(comps)
    if (entries.length > 0) {
      componentPath = entries.map(([n]) => n)
      const [firstName, firstApi] = entries[0]
      if (typeof firstApi.getComponentInfo === 'function') {
        try {
          const info = firstApi.getComponentInfo()
          if (info && info.file != null && info.line != null) {
            componentMeta = { file: info.file, line: info.line, name: info.name || firstName }
          }
        } catch {}
      }
    }
  }
  return {
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
    llui: globalThis.__llui ? {
      runtime: globalThis.__llui.runtime || 'unknown',
      compiler: globalThis.__llui.compiler || 'unknown',
    } : { runtime: 'unknown', compiler: 'unknown' },
    componentPath,
    componentMeta,
  }
})()`

interface FallbackOpts {
  prose?: string
  captureLevel?: CaptureLevel
}

async function playwrightFallback(
  cdp: CdpTransport | null,
  notesRoot: string,
  opts: FallbackOpts,
  devServerUrl?: string | null,
): Promise<unknown | null> {
  if (!cdp) return null

  // Take screenshot first — also serves as a probe that the page is
  // reachable. Errors propagate up so the tool surfaces the cdp diagnostic.
  let screenshot: { data: string }
  try {
    screenshot = await cdp.screenshot({ format: 'png' })
  } catch (err) {
    // Playwright not installed, or page not reachable — surface as a
    // soft fallback failure and let the caller see the upstream error.
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'fallback-failed' as const,
      mode: 'playwright' as const,
      error: message,
    }
  }

  let meta: PageMeta & { llui: { runtime: string; compiler: string } }
  try {
    meta = await cdp.evaluatePage<PageMeta & { llui: { runtime: string; compiler: string } }>(
      PAGE_META_EXPR,
    )
  } catch {
    meta = {
      url: '',
      viewport: { w: 0, h: 0, dpr: 1 },
      llui: { runtime: 'unknown', compiler: 'unknown' },
      componentPath: null,
      componentMeta: null,
    }
  }

  let noteBody: NoteBody
  try {
    noteBody = await cdp.evaluatePage<NoteBody>(PAGE_TELEMETRY_EXPR)
  } catch {
    noteBody = {}
  }

  const frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'> = {
    author: 'llm',
    kind: 'capture',
    captureLevel: opts.captureLevel ?? 'standard',
    url: meta.url,
    route: null,
    routeParams: {},
    viewport: meta.viewport,
    componentPath: meta.componentPath,
    componentMeta: meta.componentMeta,
    annotations: [],
    screenshot: 'placeholder.png',
    agentSchemas: [],
    llui: meta.llui,
  }

  const created = await createNoteViaServerOrDirect(devServerUrl, notesRoot, {
    body: opts.prose ?? '',
    frontmatter,
    noteBody,
    screenshot: screenshot.data,
  })

  const note = readNote(notesRoot, created.sessionId, created.id)

  return {
    status: 'fulfilled' as const,
    mode: 'playwright' as const,
    sessionId: created.sessionId,
    noteId: created.id,
    filename: created.filename,
    frontmatter: note.frontmatter,
    prose: note.prose,
    body: note.body,
    markdown: serializeNote(note),
  }
}

export function registerNotesTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_list_notes',
      description:
        'List notes in the devmode-annotate notebook. Returns frontmatter summaries (id, ts, author, kind, url, componentPath, preview). Filter by author/kind/since; default session is the current one.',
      schema: z.object({
        sessionId: z
          .string()
          .optional()
          .describe('Session id to read. Defaults to the current session.'),
        author: z.enum(['human', 'llm']).optional(),
        kind: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Filter by NoteKind: rect | lasso | pin | element | arrow | text | capture. Pass an array for multiple.',
          ),
        since: z
          .string()
          .optional()
          .describe('ISO 8601 timestamp; only notes created strictly after this are returned.'),
        limit: z.number().optional().describe('Max number of notes to return. Default 50.'),
      }),
    },
    'notes',
    async (args, ctx) => {
      const query: Parameters<typeof listNotes>[1] = {}
      if (args.sessionId) query.sessionId = args.sessionId
      if (args.author) query.author = args.author
      if (args.kind !== undefined) {
        query.kind = Array.isArray(args.kind)
          ? (args.kind as unknown as Parameters<typeof listNotes>[1]['kind'])
          : (args.kind as unknown as Parameters<typeof listNotes>[1]['kind'])
      }
      if (args.since) query.since = args.since
      if (args.limit !== undefined) query.limit = args.limit
      return listNotes(ctx.notesRoot, query)
    },
  )

  registry.register(
    {
      name: 'llui_read_note',
      description:
        'Read one note: frontmatter, prose, and the body JSON block (state snapshot, message log, effects, dirty trace — when present). Returns the raw markdown as well so it can be pasted into a downstream tool.',
      schema: z.object({
        id: z.string().describe('Note id, e.g. "001". Padded to 3 digits per session.'),
        sessionId: z.string().optional().describe('Defaults to the current session.'),
      }),
    },
    'notes',
    async (args, ctx) => {
      const sessionId = args.sessionId ?? resolveCurrentSession(ctx.notesRoot).sessionId
      const note = readNote(ctx.notesRoot, sessionId, args.id)
      const markdown = serializeNote(note)
      return {
        sessionId,
        frontmatter: note.frontmatter,
        prose: note.prose,
        body: note.body,
        markdown,
      }
    },
  )

  registry.register(
    {
      name: 'llui_list_sessions',
      description:
        'List all known notebook sessions on disk. Newest sessions appear last (lexicographically sorted by name, which is ISO-shape).',
      schema: z.object({}),
    },
    'notes',
    async (_args, ctx) => {
      // `listSessions` returns the richer `SessionListEntry[]` shape
      // (id + noteCount + startedAt) for the HUD browse-view's session
      // selector. MCP clients only need the id stream, so we project
      // here — the tool's documented surface has always been
      // `{ sessions: string[] }`.
      return { sessions: listSessions(ctx.notesRoot).map((s) => s.id) }
    },
  )

  registry.register(
    {
      name: 'llui_current_session',
      description:
        "Return metadata about the active notebook session: id, ISO start time, and the absolute on-disk notesDir. Useful as a fast 'is the notebook initialized' probe.",
      schema: z.object({}),
    },
    'notes',
    async (_args, ctx) => {
      const session = resolveCurrentSession(ctx.notesRoot)
      return {
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        notesDir: session.notesDir,
      }
    },
  )

  registry.register(
    {
      name: 'llui_capture',
      description:
        "LLM-initiated capture. Asks the connected HUD to screenshot the current page and write a note to the notebook; falls back to a headless Playwright browser when no HUD is connected (requires `playwright` installed). The tool long-polls until fulfillment, timeout, or both paths exhaust. Returns the resulting note inline (markdown + frontmatter + base64 screenshot) so a follow-up llui_read_note call isn't required. Annotation coordinates are viewport pixels — leave `annotate` empty if you only want a clean snapshot. Use this when you want a current visual of the page; use llui_list_notes / llui_read_note to read what the human has already written.",
      schema: z.object({
        prose: z.string().optional().describe('Prose body for the captured note (markdown).'),
        annotate: z
          .array(z.unknown())
          .optional()
          .describe(
            'Pre-baked annotations in viewport pixel coordinates. Schema matches Annotation from @llui/vite-plugin (rect, lasso, pin, arrow, element, highlight). The Playwright fallback does not bake annotations onto the screenshot (skipped silently in v1); the HUD path bakes them.',
          ),
        captureLevel: z.enum(['standard', 'verbose']).optional(),
        timeoutMs: z.number().optional().describe('Long-poll timeout. Default 30000.'),
        forceMode: z
          .enum(['hud', 'playwright'])
          .optional()
          .describe(
            "Override auto-select: 'hud' skips the Playwright fallback; 'playwright' goes straight to headless capture without contacting the HUD.",
          ),
      }),
    },
    'notes',
    async (args, ctx) => {
      if (!ctx.devServerUrl) {
        throw new Error(
          'llui_capture: no dev-server URL configured. Set LLUI_DEV_SERVER, pass devUrl to the MCP server, or start the Vite plugin which stamps the active marker.',
        )
      }

      // Try the HUD path first unless forceMode says otherwise.
      interface HudResult {
        requestId: string
        status: 'fulfilled' | 'timeout' | 'no-client'
        note?: { id: string; filename: string; sessionId: string }
      }
      let hudResult: HudResult | null = null

      if (args.forceMode !== 'playwright') {
        const url = `${ctx.devServerUrl}/_llui/capture-request`
        const payload: Record<string, unknown> = {}
        if (args.prose !== undefined) payload['prose'] = args.prose
        if (args.annotate !== undefined) payload['annotate'] = args.annotate
        if (args.captureLevel !== undefined) payload['captureLevel'] = args.captureLevel
        if (args.timeoutMs !== undefined) payload['timeoutMs'] = args.timeoutMs

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          throw new Error(`llui_capture: POST ${url} → ${res.status}`)
        }
        hudResult = (await res.json()) as HudResult
      }

      // On fulfillment, return the note inline so the LLM doesn't need
      // a second tool call to see what just landed.
      if (hudResult?.status === 'fulfilled' && hudResult.note) {
        const sessionId = hudResult.note.sessionId
        const note = readNote(ctx.notesRoot, sessionId, hudResult.note.id)
        return {
          status: 'fulfilled' as const,
          mode: 'hud' as const,
          requestId: hudResult.requestId,
          sessionId,
          noteId: hudResult.note.id,
          filename: hudResult.note.filename,
          frontmatter: note.frontmatter,
          prose: note.prose,
          body: note.body,
          markdown: serializeNote(note),
        }
      }

      // HUD unavailable or skipped. Try Playwright fallback unless
      // forceMode is 'hud'.
      const shouldFallback =
        args.forceMode === 'playwright' ||
        (args.forceMode !== 'hud' && hudResult?.status === 'no-client')

      if (shouldFallback) {
        const fallback = await playwrightFallback(
          ctx.cdp,
          ctx.notesRoot,
          {
            prose: args.prose,
            captureLevel: args.captureLevel,
          },
          ctx.devServerUrl,
        )
        if (fallback) return fallback
      }

      // Either fallback failed, or we're not falling back. Return the
      // HUD-side result (or synthesize a no-client when we never tried).
      return {
        status: hudResult?.status ?? 'no-client',
        mode: 'hud' as const,
        ...(hudResult?.requestId ? { requestId: hudResult.requestId } : {}),
      }
    },
  )

  registry.register(
    {
      name: 'llui_rotate_session',
      description:
        'Start a fresh notebook session. The previous session is left on disk untouched; only the active-session marker moves. Useful when starting a new debugging thread.',
      schema: z.object({}),
    },
    'notes',
    async (_args, ctx) => {
      const rotated = rotateSession(ctx.notesRoot)
      return {
        sessionId: rotated.sessionId,
        previousSessionId: rotated.previousSessionId,
        notesDir: rotated.notesDir,
      }
    },
  )

  // ── Task-mode tools (P6) ──────────────────────────────────────────

  registry.register(
    {
      name: 'llui_queue',
      description:
        "List notes that are participating in the task workflow, with their current status. Defaults to 'open', 'claimed', 'in-progress' — the work that's still active. Pass `status` to filter, or `status: ['accepted', 'applied']` to see what's already done.",
      schema: z.object({
        sessionId: z.string().optional(),
        status: z
          .union([
            z.enum([
              'open',
              'claimed',
              'in-progress',
              'proposed',
              'accepted',
              'applied',
              'rejected',
              'wontfix',
              'failed',
            ]),
            z.array(
              z.enum([
                'open',
                'claimed',
                'in-progress',
                'proposed',
                'accepted',
                'applied',
                'rejected',
                'wontfix',
                'failed',
              ]),
            ),
          ])
          .optional(),
      }),
    },
    'notes',
    async (args, ctx) => {
      const sessionId = args.sessionId ?? resolveCurrentSession(ctx.notesRoot).sessionId
      const sessionDir = join(ctx.notesRoot, sessionId)
      const statusFilter = args.status
      const queue = listQueue(
        sessionDir,
        statusFilter !== undefined ? { status: statusFilter as NoteStatus | NoteStatus[] } : {},
      )
      return { sessionId, queue }
    },
  )

  registry.register(
    {
      name: 'llui_claim_note',
      description:
        "Atomically claim a task note for processing. Reads the current status — if no one else has claimed it (status is null or 'open'), appends a 'claimed' transition and returns the note contents. If already claimed by another worker, returns the current claimant. Use a unique workerId per LLM session so concurrent workers don't double-process.",
      schema: z.object({
        noteId: z.string(),
        workerId: z.string().describe('Stable identifier for the claimer (e.g. session id).'),
        sessionId: z.string().optional(),
      }),
    },
    'notes',
    async (args, ctx) => {
      const sessionId = args.sessionId ?? resolveCurrentSession(ctx.notesRoot).sessionId
      const sessionDir = join(ctx.notesRoot, sessionId)
      const before = currentStatus(sessionDir, args.noteId)
      if (before !== null && before !== 'open') {
        const history = readStatusHistory(sessionDir, args.noteId)
        const last = history.length > 0 ? history[history.length - 1] : null
        return {
          status: 'already-claimed-by' as const,
          by: last?.reason ?? null,
          currentStatus: before,
        }
      }
      const transition: StatusTransition = {
        ts: new Date().toISOString(),
        noteId: args.noteId,
        from: before,
        to: 'claimed',
        by: 'llm',
        reason: args.workerId,
      }
      appendStatus(sessionDir, transition)
      const note = readNote(ctx.notesRoot, sessionId, args.noteId)
      return {
        status: 'claimed' as const,
        sessionId,
        noteId: args.noteId,
        frontmatter: note.frontmatter,
        prose: note.prose,
        body: note.body,
        markdown: serializeNote(note),
      }
    },
  )

  registry.register(
    {
      name: 'llui_reply_to_note',
      description:
        "Write a reply note (kind: 'reply') that answers a task. When `proposedDiff` is included, the reply is also a candidate for `accepted` status to drive auto-apply via `git apply`. Status transitions: if the original task is currently 'claimed' or 'in-progress', this call also appends a 'proposed' transition for it.",
      schema: z.object({
        replyTo: z.string().describe('Note id being replied to.'),
        prose: z.string().describe('Markdown prose body for the reply.'),
        proposedDiff: z
          .object({
            files: z.array(z.object({ path: z.string(), patch: z.string() })),
            summary: z.string(),
            confidence: z.enum(['high', 'medium', 'low']),
          })
          .optional(),
        sessionId: z.string().optional(),
      }),
    },
    'notes',
    async (args, ctx) => {
      const sessionId = args.sessionId ?? resolveCurrentSession(ctx.notesRoot).sessionId
      const sessionDir = join(ctx.notesRoot, sessionId)
      const replyId = `reply-${randomUUID().slice(0, 8)}`
      const frontmatter: Omit<NoteFrontmatter, 'id' | 'ts'> = {
        author: 'llm',
        kind: 'reply',
        captureLevel: 'standard',
        url: '',
        route: null,
        routeParams: {},
        viewport: { w: 0, h: 0, dpr: 1 },
        componentPath: null,
        componentMeta: null,
        annotations: [],
        screenshot: null,
        agentSchemas: [],
        llui: { runtime: 'unknown', compiler: 'unknown' },
        intent: 'note',
        replyTo: args.replyTo,
        ...(args.proposedDiff ? { proposedDiff: args.proposedDiff as ProposedDiff } : {}),
      }
      const created = await createNoteViaServerOrDirect(ctx.devServerUrl, ctx.notesRoot, {
        body: args.prose,
        frontmatter,
        noteBody: {},
      })

      // Bump the original task's status to 'proposed' when the reply
      // carries a diff.
      let statusTransition: StatusTransition | null = null
      if (args.proposedDiff) {
        const before = currentStatus(sessionDir, args.replyTo)
        const t: StatusTransition = {
          ts: new Date().toISOString(),
          noteId: args.replyTo,
          from: before,
          to: 'proposed',
          by: 'llm',
          reason: `reply ${created.id}: ${args.proposedDiff.summary}`,
        }
        appendStatus(sessionDir, t)
        statusTransition = t
      }

      return {
        replyNoteId: created.id,
        filename: created.filename,
        sessionId: created.sessionId,
        replyId,
        ...(statusTransition ? { statusTransition } : {}),
      }
    },
  )
}
