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
  createNote,
  listNotes,
  listSessions,
  readNote,
  resolveCurrentSession,
  rotateSession,
  serializeNote,
} from '@llui/vite-plugin/notes'
import type { CaptureLevel, NoteBody, NoteFrontmatter } from '@llui/vite-plugin'
import type { CdpTransport, ToolRegistry } from '../tool-registry.js'

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
}

const PAGE_META_EXPR = `(() => ({
  url: location.href,
  viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
  llui: globalThis.__llui ? {
    runtime: globalThis.__llui.runtime || 'unknown',
    compiler: globalThis.__llui.compiler || 'unknown',
  } : { runtime: 'unknown', compiler: 'unknown' },
}))()`

interface FallbackOpts {
  prose?: string
  captureLevel?: CaptureLevel
}

async function playwrightFallback(
  cdp: CdpTransport | null,
  notesRoot: string,
  opts: FallbackOpts,
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
    componentPath: null,
    componentMeta: null,
    annotations: [],
    screenshot: 'placeholder.png',
    agentSchemas: [],
    llui: meta.llui,
  }

  const created = createNote(notesRoot, {
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
      return { sessions: listSessions(ctx.notesRoot) }
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
        const fallback = await playwrightFallback(ctx.cdp, ctx.notesRoot, {
          prose: args.prose,
          captureLevel: args.captureLevel,
        })
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
}
