// MCP resources for the devmode-annotate notebook (P3b).
//
// Tools (llui_list_notes, llui_read_note, ...) and resources (llui://...)
// are complementary: tools are verbs the LLM invokes, resources are
// nouns it consumes. Clients that support resource subscriptions
// receive automatic notifications when the notebook contents change.
//
// Resource URIs:
//   llui://sessions                      → list of session ids
//   llui://session/current               → active session metadata + note index
//   llui://session/{id}                  → closed session metadata + note index
//   llui://session/{id}/note/{noteId}    → full note (markdown + frontmatter + body)

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import {
  listNotes,
  listSessions,
  readNote,
  resolveCurrentSession,
  serializeNote,
} from '@llui/vite-plugin/notes'

interface RegisterOpts {
  /** Returns the current notesRoot path. Captured as a getter so the
   *  MCP server can update it post-init (env reloads, etc.). */
  notesRoot: () => string
}

export function registerNotesResources(mcp: McpServer, opts: RegisterOpts): void {
  mcp.registerResource(
    'sessions',
    'llui://sessions',
    {
      title: 'LLui notebook sessions',
      description:
        'Index of every notebook session on disk. Each session is a subdirectory under `.llui/notes/`. Newest sessions appear last.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => {
      const sessions = listSessions(opts.notesRoot())
      return {
        contents: [
          {
            uri: 'llui://sessions',
            mimeType: 'application/json',
            text: JSON.stringify({ sessions }, null, 2),
          },
        ],
      }
    },
  )

  mcp.registerResource(
    'current-session',
    'llui://session/current',
    {
      title: 'Current notebook session',
      description:
        'Metadata for the active session (id, ISO start time, on-disk dir) plus the note index. Subscribe to get push notifications when new notes land.',
      mimeType: 'application/json',
    },
    async (): Promise<ReadResourceResult> => {
      const session = resolveCurrentSession(opts.notesRoot())
      const notes = listNotes(opts.notesRoot(), { sessionId: session.sessionId })
      return {
        contents: [
          {
            uri: 'llui://session/current',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                sessionId: session.sessionId,
                startedAt: session.startedAt,
                notesDir: session.notesDir,
                notes: notes.notes,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  mcp.registerResource(
    'session-by-id',
    new ResourceTemplate('llui://session/{sessionId}', {
      list: async () => {
        const sessions = listSessions(opts.notesRoot())
        return {
          resources: sessions.map((s) => ({
            uri: `llui://session/${s.id}`,
            name: s.id,
            mimeType: 'application/json',
          })),
        }
      },
    }),
    {
      title: 'Notebook session',
      description:
        'A specific session by id. Returns the same shape as llui://session/current but for a closed (or named) session.',
      mimeType: 'application/json',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const sessionId = String(variables['sessionId'] ?? '')
      const notes = listNotes(opts.notesRoot(), { sessionId })
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ sessionId, notes: notes.notes, total: notes.total }, null, 2),
          },
        ],
      }
    },
  )

  mcp.registerResource(
    'note',
    new ResourceTemplate('llui://session/{sessionId}/note/{noteId}', {
      list: undefined,
    }),
    {
      title: 'Notebook note',
      description:
        'Full content of one note: frontmatter, prose, and the body JSON block. Returns the raw markdown so the LLM can paste it elsewhere.',
      mimeType: 'text/markdown',
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const sessionId = String(variables['sessionId'] ?? '')
      const noteId = String(variables['noteId'] ?? '')
      const note = readNote(opts.notesRoot(), sessionId, noteId)
      const markdown = serializeNote(note)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: markdown,
          },
        ],
      }
    },
  )
}
