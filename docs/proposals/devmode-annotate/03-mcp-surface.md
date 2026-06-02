# 03 — MCP Surface

> **Status (2026-06-02): REALIZED.** The capture-request flow shipped (`fulfillsRequestId`, `handleCaptureRequest`). One staleness: the Playwright-subset prose still mentions `lasso`/`arrow`/`highlight`, which no longer exist — the shipped annotation set is rect + element only (see [current-state.md](./current-state.md)).

**Status:** Proposal.
**Parent:** [`README.md`](./README.md)
**Touches:** `packages/mcp/`. Optional peer dep: `playwright`.

`@llui/mcp` gains a notebook-aware surface so the LLM can read human-authored notes, get pushed updates as new notes land, and initiate captures of its own. MCP idiom: **resources** for nouns the LLM consumes, **tools** for verbs it invokes.

---

## Resources

| URI                                        | Content                                       | Subscribable                                  |
| ------------------------------------------ | --------------------------------------------- | --------------------------------------------- |
| `llui://session/current`                   | Current session metadata + note index         | Yes — fires on every `note-created` SSE event |
| `llui://session/{sessionId}`               | Closed session metadata + note index          | No                                            |
| `llui://session/{sessionId}/note/{noteId}` | Full note: frontmatter + prose + body + image | No                                            |
| `llui://sessions`                          | Index of all sessions on disk                 | Yes — fires on `session-rotated`              |

Subscribing to `llui://session/current` is the ambient channel. Claude Code clients that support MCP resource notifications get new notes pushed during the conversation without explicit polling. Clients without subscription support fall back to `llui_list_notes` polling.

### Resource contents

`llui://session/current` (JSON):

```ts
interface CurrentSessionResource {
  sessionId: string
  startedAt: string // ISO
  notesDir: string // absolute path
  notes: NoteSummary[] // sorted by id ascending
}
```

`llui://session/{sessionId}/note/{noteId}` (multi-content): returns text/markdown for the `.md` plus an image/png for the screenshot when present. The LLM receives both in one read.

---

## Tools

```ts
// llui_capture — LLM-initiated screenshot
interface LluiCaptureInput {
  // Where
  route?: string // navigate first (router-aware)
  url?: string // or absolute URL
  selector?: string // CSS or "App.UserCard.EditButton"

  // What
  annotate?: Annotation[] // pre-baked, drawn before snap
  prose?: string // initial note text
  waitForMessage?: string // wait until this msg type fires

  // How
  captureLevel?: 'standard' | 'verbose' // default 'standard'
  forceMode?: 'hud' | 'playwright' // override auto-pick
  timeoutMs?: number // default 30000
}

interface LluiCaptureOutput {
  status: 'fulfilled' | 'timeout' | 'no-client'
  mode: 'hud' | 'playwright' // which path executed
  note?: NoteSummary
  noteMarkdown?: string // full .md content inline
  screenshot?: { mimeType: 'image/png'; data: string } // base64
  error?: string
}
```

```ts
// llui_list_notes
interface LluiListNotesInput {
  sessionId?: string // default: current
  author?: Author
  kind?: NoteKind | NoteKind[]
  since?: string // ISO; only notes after this
  limit?: number // default 50
}

interface NoteSummary {
  id: string
  sessionId: string
  filename: string
  ts: string
  author: Author
  kind: NoteKind
  url: string
  componentPath: string[] | null
  preview: string // first ~80 chars of prose
  hasScreenshot: boolean
}

interface LluiListNotesOutput {
  sessionId: string
  notes: NoteSummary[]
  total: number
}
```

````ts
// llui_read_note
interface LluiReadNoteInput {
  id: string
  sessionId?: string // default: current
  includeScreenshot?: boolean // default true
  includeVerboseBody?: boolean // default true; strip ```json block heavy fields if false
}

interface LluiReadNoteOutput {
  filename: string
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
  screenshot?: { mimeType: 'image/png'; data: string }
}
````

```ts
// llui_rotate_session
interface LluiRotateSessionOutput {
  sessionId: string // new session id
  previousSessionId: string
}
```

---

## Tools deliberately omitted in v1

| Tool                  | Reason                                                         |
| --------------------- | -------------------------------------------------------------- |
| `llui_delete_note`    | `rm` works; deletion via LLM is risky and rarely needed        |
| `llui_search_notes`   | `grep` works; full-text search is a follow-up                  |
| `llui_update_note`    | Notes are immutable artifacts. Append a new note instead.      |
| `llui_export_session` | `tar` works; can add if export-to-issue-tracker becomes common |

---

## Auto-mode selection in `llui_capture`

1. MCP `POST /_llui/capture-request` to the dev server.
2. If middleware returns `{status: 'fulfilled', note}`: return that note inline.
3. If middleware returns `{status: 'no-client'}`: try Playwright fallback. If Playwright is installed: drive it, write the resulting note to disk _directly_ (bypassing the middleware — MCP has filesystem access), return inline. If Playwright is not installed: return `{status: 'no-client', error: 'No HUD connected and playwright not installed. Install with: pnpm add -D playwright'}`.
4. If middleware returns `{status: 'timeout'}`: return timeout to the LLM; do not auto-retry.

`forceMode` overrides this: `'hud'` skips the Playwright fallback entirely; `'playwright'` skips the middleware long-poll and goes straight to Playwright.

---

## Playwright fallback

When the HUD is unavailable, MCP can drive Playwright against the dev server URL:

1. Resolve dev-server URL from `LLUI_DEV_SERVER` env or auto-detect by reading the Vite config in the project dir.
2. Launch headless Chromium (cached across invocations).
3. Navigate to `route` / `url`.
4. Inject a tiny shim that mirrors the HUD's annotation-baking + metadata-gathering. This shim is shipped from `@llui/mcp` and ingested via `page.addInitScript`.
5. Wait for the `waitForMessage` condition if specified (the shim subscribes to the message bus).
6. Take screenshot via `page.screenshot`.
7. Gather metadata via the shim → `page.evaluate`.
8. Write the resulting note directly to disk in the current session, with `author: 'llm'`.

The Playwright shim is intentionally simpler than the HUD — it doesn't support lasso or pin, only `rect`, `element`, `arrow`, and `highlight` annotations. The full annotation suite is human-only.

---

## Configuration

| Env var               | Default                       | Purpose                               |
| --------------------- | ----------------------------- | ------------------------------------- |
| `LLUI_DEV_SERVER`     | auto-detect                   | Dev-server origin for HTTP and SSE    |
| `LLUI_NOTES_DIR`      | `.llui/notes`                 | Must match the middleware setting     |
| `LLUI_MCP_PLAYWRIGHT` | `auto` (`auto` \| `disabled`) | Force-disable the Playwright fallback |

---

## How resources stay in sync

The MCP server opens one SSE connection to `/_llui/events?role=mcp` at startup. On each `note-created` event, it bumps the version of the `llui://session/current` resource and notifies subscribers. Reads are always from disk (the SSE event is just a cache-bust signal) — this keeps MCP and the filesystem in lockstep even if MCP missed events while disconnected.

On reconnect after a disconnect, MCP re-reads the current session dir and emits one `notification/resources/updated` per resource that changed since the last known state.

---

## Decisions encoded

1. **Inline returns over reference-then-fetch.** `llui_capture` returns the full markdown + base64 PNG. The LLM should not have to round-trip every capture.
2. **Resources + tools, not one or the other.** Subscribers get push, pollers get pull, both supported with the same backend.
3. **Playwright is a peer dep, not bundled.** Most users will have the HUD; bundling Playwright bloats the install for everyone.
4. **MCP writes directly to disk on Playwright fallback.** The middleware doesn't need to be alive for headless capture to work.
5. **Notes are immutable.** No update or delete tool; append-only model.
6. **The Playwright shim is a subset of the HUD.** Lasso and pin are human-only by design — the LLM specifies semantic intent (`highlight` selector), not freehand strokes.

---

## Open questions

1. Should `llui_capture` support a `dryRun: true` mode that returns what the middleware _would_ do (resolved URL, resolved selector, etc.) without actually capturing? Probably yes — useful when the LLM is unsure whether its selector resolves.
2. Should there be a `llui_describe_app` resource (`llui://app`) exposing build-time-known info like the route table, the component tree shape, available agent msgs? This is bigger than this proposal — likely deserves its own design discussion.
3. Should MCP cache parsed notes in-memory or re-read disk every call? Recommendation: read-through cache invalidated by SSE events, ~50-note LRU.
