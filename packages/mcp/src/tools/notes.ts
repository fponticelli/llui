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
  listNotes,
  listSessions,
  readNote,
  resolveCurrentSession,
  rotateSession,
  serializeNote,
} from '@llui/vite-plugin/notes'
import type { ToolRegistry } from '../tool-registry.js'

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
